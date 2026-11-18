#pragma once
#include <QByteArray>
#include <QString>
#include <openssl/x509.h>

QByteArray tryCertificateDer(X509 *certificate);
QByteArray certificateDer(X509 *certificate);
QString certificateField(X509_NAME *name, int nid);
