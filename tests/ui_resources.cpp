#include "../app/browser.h"
#include <QCoreApplication>
#include <QDebug>

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    const auto html = desktopHtml(); // Reads every bundled script, icon and tooth asset.
    for (const auto &marker : {"function setNotice", "function openSettings", "error-log", "aidooGeometry"}) {
        if (!html.contains(QString::fromLatin1(marker))) {
            qCritical() << "Missing UI content:" << marker;
            return 1;
        }
    }
    return 0;
}
