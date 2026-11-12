#pragma once
#include "protocol.h"
#include "signing.h"
#include <QDeadlineTimer>
#include <QNetworkAccessManager>
#include <QTimer>

class NhisClient {
public:
    NhisClient();
    void lock();
    QString checkSignature(QWidget *parent, const QString &driver, bool remember);
    QByteArray lookup(QWidget *parent, const DentalMessage &message, bool production,
                      const QString &driver, bool remember, const PatientQuery &patient, const Practice &practice);
private:
    QByteArray requestDental(const DentalMessage &message, bool production);
    struct Response { int status; QByteArray body; };
    Response send(const QUrl &url, const QByteArray &body = {}, const QByteArray &bearer = {});
    QByteArray accessToken(bool production);
    void unlock(QWidget *parent, const QString &driver, bool remember);
    void closeIfExpired(bool remember);
    QNetworkAccessManager network;
    SigningSession signer;
    QTimer expiryTimer;
    QDeadlineTimer signingExpiry, tokenExpiry;
    QByteArray token;
    bool tokenProduction = false;
};
