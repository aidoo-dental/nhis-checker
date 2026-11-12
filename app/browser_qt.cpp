#include "browser.h"
#include <QFile>
#include <QJsonDocument>
#include <QWebChannel>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineView>

namespace {
class DesktopBridge final : public QObject {
    Q_OBJECT
    DesktopHandler handler;
public:
    explicit DesktopBridge(DesktopHandler handler, QObject *parent)
        : QObject(parent), handler(std::move(handler)) {}
    Q_INVOKABLE QString dispatch(const QString &message) {
        const auto request = QJsonDocument::fromJson(message.toUtf8()).object();
        const auto response = handler(request.value("action").toString(), request.value("data").toObject());
        return QString::fromLatin1(QJsonDocument(response).toJson(QJsonDocument::Compact).toBase64());
    }
};
class LocalPage final : public QWebEnginePage {
public:
    using QWebEnginePage::QWebEnginePage;
    bool acceptNavigationRequest(const QUrl &url, NavigationType type, bool main) override {
        Q_UNUSED(type)
        return main && (url.scheme() == "data" || url.toString().startsWith("about:blank"));
    }
};
}

QWidget *createBrowser(const QString &html, DesktopHandler handler) {
    auto *view = new QWebEngineView;
    auto *profile = new QWebEngineProfile(view);
    auto *page = new LocalPage(profile, view);
    view->setPage(page);
    view->setContextMenuPolicy(Qt::NoContextMenu);
    page->settings()->setAttribute(QWebEngineSettings::JavascriptCanOpenWindows, false);
    page->settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessFileUrls, false);
    page->settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessRemoteUrls, false);
    auto *channel = new QWebChannel(page);
    channel->registerObject("desktop", new DesktopBridge(std::move(handler), channel));
    page->setWebChannel(channel);
    QFile helper(":/qtwebchannel/qwebchannel.js");
    helper.open(QIODevice::ReadOnly);
    QString content = html;
    content.replace("<!-- QT_CHANNEL -->", "<script>" + QString::fromUtf8(helper.readAll()) + "</script>");
    view->setHtml(content);
    return view;
}
#include "browser_qt.moc"
