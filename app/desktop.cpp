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

Desktop::Desktop(QWidget *window) : window(window) {}

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
        auto entries = QJsonDocument::fromJson(config.value("errorLog").toByteArray()).array();
        if (action == "logError" && !field("message").isEmpty()) {
            entries.prepend(QJsonObject{
                {"time", QDateTime::currentDateTime().toString(Qt::ISODate)},
                {"context", field("context").left(80)},
                {"message", field("message").left(6000)},
                {"version", APP_VERSION},
                {"environment", config.value("environment", "test").toString()}});
            while (entries.size() > 100) entries.removeLast();
        }
        if (action == "clearErrorLog") entries = {};
        if (action != "errorLog") {
            config.setValue("errorLog", QJsonDocument(entries).toJson(QJsonDocument::Compact));
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
