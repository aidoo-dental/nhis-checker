#include "error.h"
#include "nhis.h"
#include <QEventLoop>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QScopeGuard>
#include <QUrl>

namespace {
[[noreturn]] void failHttp(int status, const QByteArray &body, const QString &operation) {
    const auto heading = QStringLiteral("%1 (HTTP %2).").arg(operation).arg(status);
    if (const auto rejection = nhisResponseError(tryParseNhIs(body)); !rejection.isEmpty())
        fail(heading + '\n' + rejection);

    QString advice;
    switch (status) {
    case 400:
    case 422:
        advice = QStringLiteral("НЗИС отхвърли заявката като невалидна. Провери попълнените полета.");
        break;
    case 401:
        advice = QStringLiteral("НЗИС отказа удостоверяването. Провери избрания КЕП и средата на НЗИС.");
        break;
    case 403:
        advice = QStringLiteral("НЗИС отказа достъп. Провери дали ЛПК и КЕП са на един и същ стоматолог.");
        break;
    case 404:
        advice = QStringLiteral("Услугата на НЗИС за тази операция не е намерена. Провери избраната среда.");
        break;
    case 429:
        advice = QStringLiteral("НЗИС ограничи броя на заявките. Изчакай и опитай отново.");
        break;
    default:
        if (status >= 500 && status < 600)
            advice = QStringLiteral("НЗИС върна сървърна грешка. Опитай след малко.");
        break;
    }
    fail(advice.isEmpty() ? heading : heading + '\n' + advice);
}

QDomElement authenticationContents(const QByteArray &xml) {
    const auto document = tryParseNhIs(xml);
    if (document.isNull())
        fail(QStringLiteral("При удостоверяване с КЕП НЗИС върна празен или невалиден XML отговор."));
    if (const auto rejection = nhisResponseError(document); !rejection.isEmpty())
        fail(QStringLiteral("Удостоверяване с КЕП.\n") + rejection);
    return child(document.documentElement(), "contents");
}
} // namespace

NhisClient::NhisClient() {
    expiryTimer.setSingleShot(true);
    QObject::connect(&expiryTimer, &QTimer::timeout, &expiryTimer, [this] { lock(); });
}

void NhisClient::lock() {
    expiryTimer.stop();
    signer.close();
    token.clear();
    tokenExpiry = QDeadlineTimer();
}

void NhisClient::closeIfExpired(bool remember) {
    if (!remember || signingExpiry.hasExpired()) lock();
}

void NhisClient::unlock(QWidget *parent, const QString &driver, bool remember) {
    closeIfExpired(remember);
    if (signer.isOpen()) return;
    signer.unlock(parent, driver);
    if (remember) {
        constexpr int twoHours = 2 * 60 * 60 * 1000;
        signingExpiry = QDeadlineTimer(twoHours);
        expiryTimer.start(twoHours);
    }
}

QString NhisClient::checkSignature(QWidget *parent, const QString &driver, bool remember) {
    const auto cleanup = qScopeGuard([&] { closeIfExpired(remember); });
    unlock(parent, driver, remember);
    try {
        signer.sign("<check xmlns=\"urn:bg:nzis:spravki:check\"/>");
    } catch (...) {
        lock();
        throw;
    }
    return signer.certificateName();
}

NhisClient::Response NhisClient::send(const QUrl &url, const QByteArray &body, const QByteArray &bearer) {
    QNetworkRequest request(url);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    request.setTransferTimeout(25000);
    request.setRawHeader("Accept", "application/xml");
    if (!bearer.isEmpty()) request.setRawHeader("Authorization", "Bearer " + bearer);
    if (!body.isEmpty()) request.setHeader(QNetworkRequest::ContentTypeHeader, "application/xml; charset=utf-8");
    auto *reply = body.isEmpty() ? network.get(request) : network.post(request, body);
    QEventLoop loop;
    QTimer deadline;
    deadline.setSingleShot(true);
    QObject::connect(&deadline, &QTimer::timeout, reply, &QNetworkReply::abort);
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QByteArray bytes;
    constexpr qsizetype maximum = 16 * 1024 * 1024;
    bool tooLarge = false;
    const auto read = [&] {
        if (reply->bytesAvailable() > maximum - bytes.size()) {
            tooLarge = true;
            reply->abort();
        } else {
            bytes += reply->readAll();
        }
    };
    QObject::connect(reply, &QNetworkReply::readyRead, &loop, read);
    deadline.start(30000);
    if (!reply->isFinished()) loop.exec(QEventLoop::ExcludeUserInputEvents);
    deadline.stop();
    if (!tooLarge && reply->bytesAvailable()) read();
    const auto status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const auto networkError = reply->error();
    reply->deleteLater();
    if (tooLarge) fail(QStringLiteral("Отговорът на НЗИС надвишава допустимите 16 MB."));
    if (networkError == QNetworkReply::TimeoutError || networkError == QNetworkReply::OperationCanceledError)
        fail(QStringLiteral("НЗИС не отговори навреме. Опитай отново."));
    if (networkError == QNetworkReply::SslHandshakeFailedError)
        fail(QStringLiteral("Не може да се установи защитена връзка с %1. Провери системната дата и час.").arg(url.host()));
    if (networkError == QNetworkReply::HostNotFoundError)
        fail(QStringLiteral("Адресът %1 не се открива. Провери интернет връзката.").arg(url.host()));
    if (!status || (status < 400 && networkError != QNetworkReply::NoError))
        fail(QStringLiteral("Неуспешна връзка с %1. Провери интернет връзката и опитай отново.").arg(url.host()));
    return {status, bytes};
}

QByteArray NhisClient::accessToken(bool production) {
    if (!token.isEmpty() && tokenProduction == production && !tokenExpiry.hasExpired()) return token;
    token.clear();
    const QUrl url(production ? "https://auth.his.bg/token" : "https://ptest-auth.his.bg/token");
    const auto challenge = send(url);
    if (challenge.status != 401)
        failHttp(challenge.status, challenge.body, QStringLiteral("Неуспешно получаване на заявка за удостоверяване"));
    if (value(authenticationContents(challenge.body), "challenge").isEmpty())
        fail(QStringLiteral("В отговора на НЗИС липсва заявката за удостоверяване с КЕП."));
    const auto response = send(url, signer.sign(challenge.body));
    if (response.status != 200)
        failHttp(response.status, response.body, QStringLiteral("Неуспешно удостоверяване с КЕП"));
    const auto contents = authenticationContents(response.body);
    bool validDuration = false;
    const auto seconds = value(contents, "expiresIn").toInt(&validDuration);
    const auto access = value(contents, "accessToken");
    if (!QRegularExpression("^[A-Za-z0-9._~+/=-]+$").match(access).hasMatch())
        fail(QStringLiteral("НЗИС върна невалиден токен за достъп."));
    if (!validDuration || seconds <= 0)
        fail(QStringLiteral("В отговора на НЗИС липсва валиден срок на токена за достъп."));
    tokenExpiry = QDeadlineTimer(qint64(qBound(1, seconds - 5, 7200)) * 1000);
    tokenProduction = production;
    token = access.toLatin1();
    return token;
}

QByteArray NhisClient::lookup(QWidget *parent, const DentalMessage &message, bool production,
                             const QString &driver, bool remember) {
    const auto cleanup = qScopeGuard([&] { closeIfExpired(remember); });
    unlock(parent, driver, remember);
    const auto api = QString(production ? "https://api.his.bg" : "https://ptest-api.his.bg") + message.route;
    QByteArray signedRequest;
    try {
        signedRequest = signer.sign(message.xml);
    } catch (...) {
        lock();
        throw;
    }
    auto response = send(QUrl(api), signedRequest, accessToken(production));
    if (response.status == 401) {
        token.clear();
        response = send(QUrl(api), signedRequest, accessToken(production));
    }
    try {
        if (response.status != 200)
            failHttp(response.status, response.body,
                     QStringLiteral("Неуспешна дентална справка %1").arg(message.type));
        validateDentalResponse(parseNhIs(response.body), message);
    } catch (const std::runtime_error &error) {
        fail(QString::fromUtf8(error.what()) +
             QStringLiteral("\nЗаявка %1 · ID %2").arg(message.type, message.id));
    }
    return response.body;
}
