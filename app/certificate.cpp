#include "certificate.h"
#include "error.h"

QByteArray certificateDer(X509 *cert) {
    const int size = i2d_X509(cert, nullptr);
    if (size <= 0) fail(QStringLiteral("Сертификатът не може да бъде прочетен."));
    QByteArray result(size, Qt::Uninitialized);
    auto *cursor = reinterpret_cast<unsigned char *>(result.data());
    if (i2d_X509(cert, &cursor) != size) fail(QStringLiteral("Невалиден сертификат."));
    return result;
}
QString certificateField(X509_NAME *name, int nid) {
    int index = X509_NAME_get_index_by_NID(name, nid, -1);
    if (index < 0) return {};
    unsigned char *text = nullptr;
    const int size = ASN1_STRING_to_UTF8(&text, X509_NAME_ENTRY_get_data(X509_NAME_get_entry(name, index)));
    const auto result = size > 0 ? QString::fromUtf8(reinterpret_cast<char *>(text), size) : QString();
    OPENSSL_free(text);
    return result;
}
