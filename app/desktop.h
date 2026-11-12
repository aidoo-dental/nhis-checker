#pragma once
#include "nhis.h"
#include <QJsonObject>
#include <QMap>
#include <QSettings>

class Desktop {
public:
    explicit Desktop(QWidget *window);
    QJsonObject dispatch(const QString &action, const QJsonObject &data);
private:
    QJsonObject settings() const;
    QJsonObject run(const QString &action, const QJsonObject &data);
    QWidget *window;
    QSettings config;
    NhisClient client;
    bool busy = false;
    struct SavedResponse { QString id, type; QByteArray xml; };
    QMap<QString, SavedResponse> responses;
};
