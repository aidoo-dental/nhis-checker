#include "browser.h"
#include <QDir>
#include <QFile>
#include <QJsonDocument>

namespace {
QString resource(const QString &name) {
    QFile file(":/app/ui/" + name);
    if (!file.open(QIODevice::ReadOnly)) qFatal("A bundled UI resource is missing.");
    return QString::fromUtf8(file.readAll());
}
}

QString desktopHtml() {
    auto html = resource("index.html");
    html.replace("<!-- APP_NAME -->", QStringLiteral(APP_NAME));
    QString icons = ":root{";
    for (const QString name : {"done", "cancelled", "pending", "unknown"}) {
        icons += "--aidoo-" + name + ":url(\"data:image/svg+xml," +
            QString::fromLatin1(resource("status/" + name + ".svg").toUtf8().toPercentEncoding()) + "\");";
    }
    html.replace("<!-- STYLES -->", "<style>" + icons + "}\n" + resource("styles.css") + "</style>");
    QJsonObject geometry;
    const QDir teeth(":/app/ui/teeth");
    for (const auto &filename : teeth.entryList({"*.svg"}, QDir::Files))
        geometry.insert(filename.chopped(4), resource("teeth/" + filename));
    QString scripts = "const aidooGeometry = " + QString::fromUtf8(QJsonDocument(geometry).toJson(QJsonDocument::Compact))
        + ";\nconst nomenclatures = " + resource("nomenclatures.json") + ";\n";
    for (const auto &file : {"layout.js", "xml-response.js", "odontogram.js", "treatments.js", "bridge.js", "notifications.js", "lookups.js", "settings.js"})
        scripts += resource(file) + "\n";
    html.replace("<!-- SCRIPTS -->", "<script>" + scripts + "</script>");
    return html;
}
