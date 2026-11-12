#pragma once
#include <QByteArray>
#include <QDomDocument>
#include <QString>

struct PatientQuery {
    QString first, middle, last, identifierType, identifier;
};
struct Practice {
    QString lpk, registration;
};
struct DentalMessage {
    QByteArray xml;
    QString id, type, replyType, route;
};

void validatePractice(const Practice &practice);
DentalMessage makeDentalMessage(bool status, const PatientQuery &patient, const Practice &practice);
QDomDocument tryParseNhIs(const QByteArray &xml);
QDomDocument parseNhIs(const QByteArray &xml);
QDomElement child(const QDomElement &parent, const QString &name);
QString value(const QDomElement &parent, const QString &name);
QString nhisResponseError(const QDomDocument &document);
void validateDentalResponse(const QDomDocument &document, const DentalMessage &request);
