#pragma once
#include <QByteArray>
#include <QString>
#include <openssl/x509.h>

QByteArray certificateDer(X509 *certificate);
QString certificateField(X509_NAME *name, int nid);
