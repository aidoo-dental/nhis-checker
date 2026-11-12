// SPDX-License-Identifier: GPL-3.0-only
// Enveloped XAdES adapted from DinoDent, src/Network/{signer,crypto}.cpp.
#include "xml_signature.h"
#include "error.h"
#include "certificate.h"
#include <QCryptographicHash>
#include <QDateTime>
#include <libxml/c14n.h>
#include <libxml/parser.h>
#include <openssl/evp.h>
#include <openssl/x509.h>

namespace {
constexpr auto ds = "http://www.w3.org/2000/09/xmldsig#";
constexpr auto xa = "http://uri.etsi.org/01903/v1.3.2#";
constexpr auto c14n = "http://www.w3.org/2001/10/xml-exc-c14n#";
using Doc = std::unique_ptr<xmlDoc, decltype(&xmlFreeDoc)>;
using Md = std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)>;

Doc parse(const QByteArray &xml) {
    Doc doc(xmlReadMemory(xml.constData(), int(xml.size()), nullptr, nullptr,
        XML_PARSE_NONET | XML_PARSE_NOERROR | XML_PARSE_NOWARNING), xmlFreeDoc);
    if (!doc || doc->intSubset || doc->extSubset || !xmlDocGetRootElement(doc.get()))
        fail(QStringLiteral("Невалидно XML съобщение за подписване."));
    return doc;
}
QByteArray canonical(xmlDoc *doc) {
    xmlChar *bytes = nullptr;
    int size = xmlC14NDocDumpMemory(doc, nullptr, XML_C14N_EXCLUSIVE_1_0, nullptr, 0, &bytes);
    const QByteArray output = size < 0 ? QByteArray() : QByteArray(reinterpret_cast<char *>(bytes), size);
    xmlFree(bytes);
    if (size < 0) fail(QStringLiteral("Неуспешна XML канонизация."));
    return output;
}
QByteArray canonical(const QByteArray &xml) { return canonical(parse(xml).get()); }
QByteArray digest(const QByteArray &value) {
    return QCryptographicHash::hash(value, QCryptographicHash::Sha256).toBase64();
}
QByteArray rsaSign(const QByteArray &data, EVP_PKEY *key) {
    Md context(EVP_MD_CTX_new(), EVP_MD_CTX_free);
    size_t size = 0;
    if (!context || EVP_DigestSignInit(context.get(), nullptr, EVP_sha256(), nullptr, key) != 1 ||
        EVP_DigestSignUpdate(context.get(), data.constData(), size_t(data.size())) != 1 ||
        EVP_DigestSignFinal(context.get(), nullptr, &size) != 1)
        fail(QStringLiteral("КЕП не може да подпише заявката с RSA-SHA256."));
    QByteArray signature(qsizetype(size), Qt::Uninitialized);
    if (EVP_DigestSignFinal(context.get(), reinterpret_cast<unsigned char *>(signature.data()), &size) != 1)
        fail(QStringLiteral("Подписването е неуспешно. Провери дали токенът е включен."));
    signature.resize(qsizetype(size));
    return signature;
}
} // namespace

QByteArray signEnveloped(const QByteArray &xml, EVP_PKEY *key, X509 *cert) {
    auto doc = parse(xml);
    const auto certificate = certificateDer(cert);
    const auto time = QDateTime::currentDateTimeUtc().toString(Qt::ISODate).toUtf8();
    const auto country = certificateField(X509_get_subject_name(cert), NID_countryName).toHtmlEscaped().toUtf8();
    const QByteArray namespaces = QByteArray(" xmlns:ds=\"") + ds + "\" xmlns:xades=\"" + xa + "\"";
    const QByteArray props = QByteArray("<xades:SignedProperties") + namespaces + " Id=\"xadesNode\">"
        "<xades:SignedSignatureProperties><xades:SigningTime>" + time + "</xades:SigningTime>"
        "<xades:SigningCertificateV2><xades:Cert><xades:CertDigest>"
        "<ds:DigestMethod Algorithm=\"http://www.w3.org/2001/04/xmlenc#sha256\"/>"
        "<ds:DigestValue>" + digest(certificate) + "</ds:DigestValue></xades:CertDigest>"
        "</xades:Cert></xades:SigningCertificateV2><xades:SignatureProductionPlaceV2>"
        "<xades:City/><xades:StateOrProvince/><xades:PostalCode/><xades:CountryName>" + country +
        "</xades:CountryName></xades:SignatureProductionPlaceV2>"
        "<xades:SignerRoleV2><xades:ClaimedRoles><xades:ClaimedRole>SIGNED BY</xades:ClaimedRole>"
        "</xades:ClaimedRoles></xades:SignerRoleV2></xades:SignedSignatureProperties>"
        "<xades:SignedDataObjectProperties><xades:DataObjectFormat ObjectReference=\"#r-id-1\">"
        "<xades:MimeType>text/xml</xades:MimeType></xades:DataObjectFormat>"
        "</xades:SignedDataObjectProperties></xades:SignedProperties>";
    const QByteArray referenceTail = QByteArray("<ds:Transform Algorithm=\"") + c14n + "\"/>"
        "</ds:Transforms><ds:DigestMethod Algorithm=\"http://www.w3.org/2001/04/xmlenc#sha256\"/>";
    const QByteArray info = QByteArray("<ds:SignedInfo xmlns:ds=\"") + ds + "\">"
        "<ds:CanonicalizationMethod Algorithm=\"" + c14n + "\"/>"
        "<ds:SignatureMethod Algorithm=\"http://www.w3.org/2001/04/xmldsig-more#rsa-sha256\"/>"
        "<ds:Reference Id=\"r-id-1\" URI=\"\"><ds:Transforms>"
        "<ds:Transform Algorithm=\"http://www.w3.org/2000/09/xmldsig#enveloped-signature\"/>" + referenceTail +
        "<ds:DigestValue>" + digest(canonical(doc.get())) + "</ds:DigestValue></ds:Reference>"
        "<ds:Reference Type=\"http://uri.etsi.org/01903#SignedProperties\" URI=\"#xadesNode\">"
        "<ds:Transforms>" + referenceTail + "<ds:DigestValue>" + digest(canonical(props)) +
        "</ds:DigestValue></ds:Reference></ds:SignedInfo>";
    const QByteArray signature = QByteArray("<ds:Signature") + namespaces + " Id=\"signatureNode\">" + info +
        "<ds:SignatureValue Id=\"value-signatureNode\">" + rsaSign(canonical(info), key).toBase64() +
        "</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>" + certificate.toBase64() +
        "</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object>"
        "<xades:QualifyingProperties Target=\"#signatureNode\">" + props +
        "</xades:QualifyingProperties></ds:Object></ds:Signature>";
    auto sigDoc = parse(signature);
    auto *copy = xmlDocCopyNode(xmlDocGetRootElement(sigDoc.get()), doc.get(), 1);
    if (!copy) fail(QStringLiteral("Неуспешно вграждане на XML подписа."));
    xmlAddChild(xmlDocGetRootElement(doc.get()), copy);
    xmlChar *bytes = nullptr;
    int size = 0;
    xmlDocDumpMemoryEnc(doc.get(), &bytes, &size, "UTF-8");
    const QByteArray output(reinterpret_cast<char *>(bytes), size);
    xmlFree(bytes);
    if (output.isEmpty()) fail(QStringLiteral("Неуспешно записване на подписаното съобщение."));
    return output;
}
