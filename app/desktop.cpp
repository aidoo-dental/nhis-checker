#include "error.h"
#include "desktop.h"
#include <QFileDialog>
#include <QFileInfo>
#include <QSaveFile>
#include <QScopedValueRollback>
#include <QWidget>
#include <QClipboard>
#include <QDateTime>
#include <QGuiApplication>
#include <QJsonArray>
#include <QJsonDocument>
#include <QRegularExpression>

Desktop::Desktop(QWidget *window) : window(window) {
    // The previous journal included free text from the server.
    if (config.contains("errorLog")) {
        config.remove("errorLog");
        config.sync();
    }
}

QJsonObject Desktop::settings() const {
    return {{"lpk", config.value("lpk").toString()}, {"practice", config.value("practice").toString()},
            {"environment", config.value("environment", "test").toString()},
            {"driver", config.value("driver").toString()}, {"remember", config.value("remember", true).toBool()}};
}

QJsonObject Desktop::dispatch(const QString &action, const QJsonObject &data) {
    try {
        if (busy) fail(QStringLiteral("Изчакай текущата операция да приключи."));
        QScopedValueRollback<bool> guard(busy, true);
        return run(action, data);
    } catch (const std::exception &error) {
        return {{"error", QString::fromUtf8(error.what())}};
    }
}

QJsonObject Desktop::run(const QString &action, const QJsonObject &data) {
    const auto field = [&](const QString &key) { return data.value(key).toString().trimmed(); };
    if (action == "settings") return settings();
    if (action == "errorLog" || action == "logError" || action == "clearErrorLog") {
        auto entries = QJsonDocument::fromJson(config.value("errorLogV2").toByteArray()).array();
        if (action == "logError" && !field("message").isEmpty()) {
            const auto view = field("view");
            const bool localKep = view == "settings" && field("operation") == "checkSignature";
            const auto context = localKep ? QStringLiteral("Проверка на КЕП")
                : view == "status" ? QStringLiteral("Дентален статус")
                : view == "treatments" ? QStringLiteral("Лечения")
                : view == "settings" ? QStringLiteral("Настройки") : QStringLiteral("Пациент");
            QStringList details;
            static const QRegularExpression metadata(QStringLiteral(
                R"(\A(?:Код [A-Z][0-9]{3}|Заявка D00[59] · ID [0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|Неуспешна дентална справка D00[59] \(HTTP [1-5][0-9]{2}\)\.|НЗИС върна грешка \([A-Z]099\)\.|НЗИС върна неочакван тип отговор\. Очаква се D0(?:06|10)\.)\z)"));
            static const QStringList knownReasons{
                QStringLiteral("Сертификатът не може да бъде прочетен."),
                QStringLiteral("НЗИС върна празен отговор. Повтори справката."),
                QStringLiteral("НЗИС върна отговор в неочакван формат. Очаква се XML съобщение."),
                QStringLiteral("В XML отговора на НЗИС липсва типът на съобщението."),
                QStringLiteral("Отговорът на НЗИС е за друга заявка. Повтори справката."),
                QStringLiteral("В отговора на НЗИС липсва денталният статус."),
                QStringLiteral("НЗИС не върна записи или валиден общ брой лечения."),
                QStringLiteral("НЗИС съобщи за намерени лечения, но не върна записи за проверка."),
                QStringLiteral("НЗИС не върна достатъчно пациентски данни за проверка на имената и идентификатора. Справката е блокирана."),
                QStringLiteral("Имената и идентификаторът не съвпадат с пациентските данни, върнати от НЗИС. Провери изписването. Справката е блокирана.")
            };
            for (const auto &line : field("message").left(6000).split('\n')) {
                if (details.size() < 12 && (metadata.match(line).hasMatch() || knownReasons.contains(line)))
                    details << line;
            }
            entries.prepend(QJsonObject{
                {"time", QDateTime::currentDateTime().toString(Qt::ISODate)},
                {"context", context},
                {"message", details.isEmpty() ? QStringLiteral("Операцията е неуспешна.") : details.join('\n')},
                {"version", APP_VERSION},
                {"environment", localKep ? QStringLiteral("local") : config.value("environment", "test").toString()}});
            while (entries.size() > 100) entries.removeLast();
        }
        if (action == "clearErrorLog") entries = {};
        if (action != "errorLog") {
            config.setValue("errorLogV2", QJsonDocument(entries).toJson(QJsonDocument::Compact));
            config.sync();
            if (config.status() != QSettings::NoError)
                fail(QStringLiteral("Журналът на грешките не можа да се запази."));
        }
        return {{"entries", entries}};
    }
    if (action == "copyErrorLog") {
        QGuiApplication::clipboard()->setText(field("text").left(700000));
        return {};
    }
    if (action == "saveSettings") {
        validatePractice({field("lpk"), field("practice")});
        if (field("environment") != "test" && field("environment") != "production")
            fail(QStringLiteral("Избери тестова или продукционна среда на НЗИС."));
        const auto driver = field("driver");
        if (!driver.isEmpty() && (!QFileInfo(driver).isAbsolute() || !QFileInfo(driver).isFile()))
            fail(QStringLiteral("Избери съществуващ локален PKCS#11 драйвер."));
        if (settings() != data) {
            client.lock();
            responses.clear();
        }
        for (const auto &key : {"lpk", "practice", "environment", "driver"}) config.setValue(key, field(key));
        config.setValue("remember", data.value("remember").toBool());
        config.sync();
        if (config.status() != QSettings::NoError) fail(QStringLiteral("Настройките не можаха да се запазят."));
        return settings();
    }
    if (action == "chooseDriver") {
        return {{"driver", QFileDialog::getOpenFileName(window, QStringLiteral("Избери PKCS#11 драйвер"),
            {}, QStringLiteral("PKCS#11 (*.dll *.dylib *.so)"))}};
    }
    if (action == "lock") {
        client.lock();
        return {};
    }
    if (action == "checkSignature") {
        const auto prefs = settings();
        return {{"certificate", client.checkSignature(window, prefs.value("driver").toString(),
                                                        prefs.value("remember").toBool())}};
    }
    const auto view = field("view");
    if (view != "status" && view != "treatments") fail(QStringLiteral("Непозната справка."));
    if (action == "lookup") {
        responses.remove(view);
        const auto prefs = settings();
        const PatientQuery patient{field("first"), field("middle"), field("last"),
                                   field("identifierType"), field("identifier")};
        const Practice practice{prefs.value("lpk").toString(), prefs.value("practice").toString()};
        const auto request = makeDentalMessage(view == "status", patient, practice);
        auto xml = client.lookup(window, request, prefs.value("environment") == "production",
                                 prefs.value("driver").toString(), prefs.value("remember").toBool(), patient, practice);
        if (xml.isEmpty()) return {{"empty", true}};
        const auto text = QString::fromUtf8(xml);
        responses.insert(view, {request.id, request.replyType, std::move(xml)});
        return {{"id", request.id}, {"xml", text}};
    }
    if (action == "discard") {
        const auto it = responses.find(view);
        if (it != responses.end() && (field("id").isEmpty() || it->id == field("id"))) responses.erase(it);
        return {};
    }
    if (action == "saveXml") {
        const auto response = responses.value(view);
        if (response.xml.isEmpty() || response.id != field("id"))
            fail(QStringLiteral("Първо изтегли справката за този пациент."));
        const auto path = QFileDialog::getSaveFileName(window, QStringLiteral("Запази XML от НЗИС"),
            "NZIS-" + response.type + ".xml", QStringLiteral("XML документ (*.xml)"));
        if (path.isEmpty()) return {};
        QSaveFile file(path);
        if (!file.open(QIODevice::WriteOnly) || file.write(response.xml) != response.xml.size() || !file.commit())
            fail(QStringLiteral("XML файлът не можа да се запази."));
        return {{"saved", true}};
    }
    fail(QStringLiteral("Непозната команда."));
}
