#include "browser.h"
#include "desktop.h"
#include <QApplication>
#include <QMainWindow>
#include <QScreen>
#include <memory>

int main(int argc, char **argv) {
    QApplication application(argc, argv);
    application.setOrganizationName("NZIS Spravki");
    application.setOrganizationDomain("bg.nzis.spravki");
#ifdef NHIS_WEBVIEW2_PREVIEW
    application.setApplicationName("NHIS Checker WebView2 Preview");
#else
    application.setApplicationName("NZIS Spravki");
#endif
    application.setApplicationDisplayName(QStringLiteral(APP_NAME));
    application.setApplicationVersion(APP_VERSION);
    QMainWindow window;
#ifdef Q_OS_MACOS
    addBrowserEditMenu(window);
#endif
    auto desktop = std::make_shared<Desktop>(&window);
    window.setCentralWidget(createBrowser(desktopHtml(),
        [desktop](const QString &action, const QJsonObject &data) { return desktop->dispatch(action, data); }));
    window.setWindowTitle(application.applicationDisplayName());
    window.setMinimumSize(640, 500);
    const QSize available = window.screen()->availableGeometry().size();
    window.resize(qMin(1200, available.width()), qMin(900, available.height()));
    window.show();
    return application.exec();
}
