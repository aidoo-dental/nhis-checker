#include "certificate.h"
#include "protocol.h"
#include "xml_signature.h"
#include <QCoreApplication>
#include <QCryptographicHash>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <libxml/c14n.h>
#include <libxml/parser.h>
#include <libxml/xpath.h>
#include <libxml/xpathInternals.h>
#include <openssl/evp.h>
#include <openssl/x509.h>

namespace {
using Doc = std::unique_ptr<xmlDoc, decltype(&xmlFreeDoc)>;
using XPath = std::unique_ptr<xmlXPathContext, decltype(&xmlXPathFreeContext)>;
using XPathResult = std::unique_ptr<xmlXPathObject, decltype(&xmlXPathFreeObject)>;

void expect(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}

Doc readXml(const QByteArray &xml) {
    Doc document(xmlReadMemory(xml.constData(), int(xml.size()), nullptr, nullptr, XML_PARSE_NONET), xmlFreeDoc);
    expect(bool(document), "Signed XML could not be parsed");
    return document;
}

XPathResult evaluate(xmlDoc *document, const QByteArray &expression) {
    XPath context(xmlXPathNewContext(document), xmlXPathFreeContext);
    expect(bool(context), "XPath context is unavailable");
    xmlXPathRegisterNs(context.get(), BAD_CAST "ds", BAD_CAST "http://www.w3.org/2000/09/xmldsig#");
    xmlXPathRegisterNs(context.get(), BAD_CAST "xades", BAD_CAST "http://uri.etsi.org/01903/v1.3.2#");
    XPathResult result(xmlXPathEvalExpression(BAD_CAST expression.constData(), context.get()), xmlXPathFreeObject);
    expect(bool(result), "XPath expression failed");
    return result;
}

QByteArray xpathText(xmlDoc *document, const QByteArray &expression) {
    auto result = evaluate(document, "string(" + expression + ")");
    return QByteArray(reinterpret_cast<const char *>(result->stringval));
}

QByteArray canonical(xmlDoc *document, const QByteArray &element = {}) {
    XPathResult nodes(nullptr, xmlXPathFreeObject);
    if (!element.isEmpty()) {
        const auto descendants = element + "/descendant-or-self::*";
        nodes = evaluate(document, element + "/descendant-or-self::node() | " +
                         descendants + "/@* | " + descendants + "/namespace::*");
    }
    xmlChar *bytes = nullptr;
    const auto size = xmlC14NDocDumpMemory(document, nodes ? nodes->nodesetval : nullptr,
                                           XML_C14N_EXCLUSIVE_1_0, nullptr, 0, &bytes);
    expect(size > 0, "Canonical XML is empty");
    QByteArray result(reinterpret_cast<const char *>(bytes), size);
    xmlFree(bytes);
    return result;
}

QByteArray digest(const QByteArray &value) {
    return QCryptographicHash::hash(value, QCryptographicHash::Sha256).toBase64();
}

void verifySignature(const QByteArray &xml) {
    std::unique_ptr<EVP_PKEY, decltype(&EVP_PKEY_free)> key(
        EVP_PKEY_Q_keygen(nullptr, nullptr, "RSA", 2048), EVP_PKEY_free);
    std::unique_ptr<X509, decltype(&X509_free)> certificate(X509_new(), X509_free);
    expect(key && certificate, "Software test certificate setup failed");
    expect(X509_set_pubkey(certificate.get(), key.get()) == 1, "Cannot attach test public key");
    expect(X509_gmtime_adj(X509_getm_notBefore(certificate.get()), -60) != nullptr, "Cannot set test validity");
    expect(X509_gmtime_adj(X509_getm_notAfter(certificate.get()), 3600) != nullptr, "Cannot set test validity");
    auto *subject = X509_get_subject_name(certificate.get());
    expect(X509_NAME_add_entry_by_txt(subject, "CN", MBSTRING_ASC, BAD_CAST "NZIS local test",
                                     -1, -1, 0) == 1, "Cannot set test subject");
    expect(X509_set_issuer_name(certificate.get(), subject) == 1 &&
        X509_sign(certificate.get(), key.get(), EVP_sha256()) > 0, "Cannot sign test certificate");

    auto signedXml = readXml(signEnveloped(xml, key.get(), certificate.get()));
    auto *document = signedXml.get();
    expect(xpathText(document, "//ds:Reference[@URI='']/ds:Transforms/ds:Transform[1]/@Algorithm") ==
               "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
           "The document reference must use the enveloped-signature transform");
    const auto signedInfo = canonical(document, "//ds:SignedInfo");
    const auto signature = QByteArray::fromBase64(xpathText(document, "//ds:SignatureValue"));
    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> verifier(EVP_MD_CTX_new(), EVP_MD_CTX_free);
    expect(verifier && EVP_DigestVerifyInit(verifier.get(), nullptr, EVP_sha256(), nullptr, key.get()) == 1 &&
        EVP_DigestVerify(verifier.get(), reinterpret_cast<const unsigned char *>(signature.constData()),
                         size_t(signature.size()), reinterpret_cast<const unsigned char *>(signedInfo.constData()),
                         size_t(signedInfo.size())) == 1, "RSA signature on canonical SignedInfo does not verify");
    expect(xpathText(document, "//ds:X509Certificate") == certificateDer(certificate.get()).toBase64(),
           "Embedded signing certificate differs");
    expect(xpathText(document, "//ds:Reference[@URI='#xadesNode']/ds:DigestValue") ==
           digest(canonical(document, "//xades:SignedProperties")), "SignedProperties digest differs");
    const auto documentDigest = xpathText(document, "//ds:Reference[@URI='']/ds:DigestValue");
    auto signatureNode = evaluate(document, "//ds:Signature");
    expect(signatureNode->nodesetval && signatureNode->nodesetval->nodeNr == 1, "Expected one signature");
    auto *node = signatureNode->nodesetval->nodeTab[0];
    xmlUnlinkNode(node);
    xmlFreeNode(node);
    expect(documentDigest == digest(canonical(document)), "Enveloped document digest differs");
}

void verifyIdentity() {
    const PatientQuery patient{QStringLiteral("Иван"), {}, QStringLiteral("Тестов"), "1", "0000000000"};
    const auto subject = QStringLiteral(
        "<subject><identifierType value=\"1\"/><identifier value=\"0000000000\"/>"
        "<name><given value=\"Иван\"/><middle value=\"Петров\"/><family value=\"Тестов\"/></name></subject>");
    const auto response = [](const QString &subjects) {
        return parseNhIs((QStringLiteral("<message xmlns=\"https://www.his.bg\"><header>"
            "<messageType value=\"D006\"/></header><contents><foundNumber value=\"1\"/>") +
            subjects + QStringLiteral("</contents></message>")).toUtf8());
    };
    const auto one = "<results>" + subject + "</results>";
    validatePatientIdentity(response(one), patient);
    auto normalized = patient;
    normalized.first = QStringLiteral("  ИВАН  ");
    normalized.last = QStringLiteral("тестов");
    validatePatientIdentity(response(one), normalized);
    normalized.middle = QStringLiteral("петров");
    validatePatientIdentity(response(one), normalized);
    const auto rejects = [&](const QString &xml, const PatientQuery &query) {
        try { validatePatientIdentity(response(xml), query); }
        catch (const std::runtime_error &error) {
            expect(!QString::fromUtf8(error.what()).contains(QStringLiteral("Тестов")),
                   "A blocked lookup must not disclose returned patient names");
            return;
        }
        throw std::runtime_error("Unverified patient identity was accepted");
    };
    auto wrong = patient;
    wrong.last = QStringLiteral("Тест");
    rejects(one, wrong);
    wrong = patient; wrong.first = QStringLiteral("Друг"); rejects(one, wrong);
    wrong = patient; wrong.first = QStringLiteral("   "); rejects(one, wrong);
    wrong = patient; wrong.identifier = "0000000001"; rejects(one, wrong);
    wrong = patient; wrong.identifierType = "2"; rejects(one, wrong);
    wrong = patient; wrong.middle = QStringLiteral("Друг"); rejects(one, wrong);
    rejects({}, patient);
    rejects("<results/>", patient);
    auto missing = one; missing.replace(QStringLiteral("<given value=\"Иван\"/>"), QString());
    rejects(missing, patient);
    auto mismatched = one; mismatched.replace("0000000000", "0000000001");
    rejects(one + mismatched, patient); // Every result must belong to the same named patient.
    auto foreignNamespace = one; foreignNamespace.replace("<subject>", "<subject xmlns=\"urn:other\">");
    rejects(foreignNamespace, patient);
}

void verifyProtocol() {
    const PatientQuery patient{QStringLiteral("Иван & Мария"), {}, QStringLiteral("Тестови"), "4", "ABC\"123"};
    const Practice practice{"012345678", "0012345678"};
    const auto treatment = makeDentalMessage(false, patient, practice);
    const auto status = makeDentalMessage(true, patient, practice);
    const auto query = parseNhIs(treatment.xml).documentElement();
    const auto treatmentContents = child(query, "contents");
    expect(value(child(query, "header"), "messageType") == "D005" &&
           value(child(query, "header"), "senderId") == practice.lpk &&
           value(treatmentContents, "identifierType") == patient.identifierType &&
           value(treatmentContents, "identifier") == patient.identifier &&
           child(treatmentContents, "name").isNull() &&
           child(treatmentContents, "nrnDental").isNull() &&
           child(treatmentContents, "treatmentStart").isNull(), "D005 must search by identifier only");
    const auto statusRoot = parseNhIs(status.xml).documentElement();
    const auto statusContents = child(statusRoot, "contents");
    expect(value(statusContents, "practiceNumber") == practice.registration &&
           value(child(statusRoot, "header"), "senderId") == practice.lpk &&
           child(statusContents, "name").isNull(), "D009 request fields differ from specification");
    expect(treatment.id != status.id && treatment.route == "/v1/edental/record/fetch" &&
           status.route == "/v1/edental/status/get", "Unexpected request routing");
    const QByteArray response = "<?xml version=\"1.0\"?><h:message xmlns:h=\"https://www.his.bg\">"
        "<h:header><h:messageType value=\"D006\"/><h:messageId value=\"" + treatment.id.toUtf8() +
        "\"/></h:header><h:contents><h:foundNumber value=\"0\"/></h:contents></h:message>";
    validateDentalResponse(parseNhIs(response), treatment);
    bool rejected = false;
    try {
        validateDentalResponse(parseNhIs(response), status);
    } catch (const std::exception &) { rejected = true; }
    expect(rejected, "A response for a different request was accepted");

    const auto rejection = parseNhIs(
        "<h:message xmlns:h=\"https://www.his.bg\">"
        "<h:header><h:messageType value=\"D099\"/></h:header><h:contents>"
        "<h:error><h:type value=\"E003\"/><h:reason value=\"Test rejection\"/>"
        "<h:description value=\"Additional information\"/><h:faultyAttribute value=\"senderId\"/></h:error>"
        "<h:error><h:type value=\"E002\"/></h:error>"
        "</h:contents></h:message>");
    const auto errorText = nhisResponseError(rejection);
    expect(errorText.contains("D099") && errorText.contains("E003") && errorText.contains("E002") &&
           !errorText.contains("Test rejection") && !errorText.contains("Additional information") &&
           !errorText.contains("senderId"), "NHIS errors must retain codes and omit server text");
    rejected = false;
    try {
        validateDentalResponse(rejection, status);
    } catch (const std::runtime_error &error) {
        rejected = QString::fromUtf8(error.what()) == errorText;
    }
    expect(rejected, "D099 was not reported with its diagnostic details");
    expect(tryParseNhIs("<html>Gateway error</html>").isNull(), "An HTML gateway error was accepted as NHIS XML");
    const QByteArray deep = "<message xmlns=\"https://www.his.bg\">" +
        QByteArray("<item>").repeated(64) + QByteArray("</item>").repeated(64) + "</message>";
    expect(tryParseNhIs(deep).isNull(), "Excessive XML depth reached the DOM parser");
    expect(nhisResponseError(parseNhIs(response)).isEmpty(), "A successful response was treated as an error");

    verifySignature(treatment.xml);
    verifySignature(status.xml);
    const QByteArray challenge = "<?xml version=\"1.1\" encoding=\"UTF-8\"?><nhis:message xmlns:nhis=\"https://www.his.bg\">"
        "<nhis:contents><nhis:challenge value=\"fixture\"/></nhis:contents></nhis:message>";
    expect(value(child(parseNhIs(challenge).documentElement(), "contents"), "challenge") == "fixture",
           "XML 1.1 challenge could not be read");
    verifySignature(challenge);
}
} // namespace

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    try {
        verifyProtocol();
        verifyIdentity();
    } catch (const std::exception &error) {
        std::fprintf(stderr, "%s\n", error.what());
        return 1;
    }
    return 0;
}
