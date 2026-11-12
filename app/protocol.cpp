#include "protocol.h"
#include "error.h"
#include <QDateTime>
#include <QRegularExpression>
#include <QStringList>
#include <QTimeZone>
#include <QUuid>
#include <QXmlStreamWriter>
#include <libxml/xmlreader.h>
#include <memory>

namespace {
const QString ns = QStringLiteral("https://www.his.bg");
}

void validatePractice(const Practice &practice) {
    if (!QRegularExpression("^[0-9]{9}$").match(practice.lpk).hasMatch())
        fail(QStringLiteral("Въведи 9-цифрения ЛПК на стоматолога в „Настройки“."));
    if (!QRegularExpression("^[0-9]{10}$").match(practice.registration).hasMatch())
        fail(QStringLiteral("Въведи 10-цифрения РЗИ номер на практиката в „Настройки“."));
}

DentalMessage makeDentalMessage(bool status, const PatientQuery &patient, const Practice &practice) {
    if (patient.first.trimmed().isEmpty() || patient.last.trimmed().isEmpty() || patient.identifier.isEmpty() ||
        patient.identifier.size() > 255 || patient.first.size() > 255 || patient.middle.size() > 255 ||
        patient.last.size() > 255 || !QRegularExpression("^[1-6]$").match(patient.identifierType).hasMatch())
        fail(QStringLiteral("Въведи име, фамилия и валиден идентификатор на пациента."));
    if ((patient.identifierType == "1" || patient.identifierType == "2") &&
        !QRegularExpression("^[0-9]{10}$").match(patient.identifier).hasMatch())
        fail(QStringLiteral("ЕГН и ЛНЧ се въвеждат като 10 цифри."));
    validatePractice(practice);

    DentalMessage result;
    result.id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    result.type = status ? "D009" : "D005";
    result.replyType = status ? "D010" : "D006";
    result.route = status ? "/v1/edental/status/get" : "/v1/edental/record/fetch";
    const auto now = QDateTime::currentDateTimeUtc().toTimeZone(QTimeZone("Europe/Sofia"));
    QXmlStreamWriter xml(&result.xml);
    const auto field = [&](const QString &name, const QString &value) {
        xml.writeEmptyElement("nhis:" + name);
        xml.writeAttribute("value", value);
    };
    xml.writeStartDocument();
    xml.writeStartElement("nhis:message");
    xml.writeNamespace(ns, "nhis");
    xml.writeNamespace("http://www.w3.org/2001/XMLSchema-instance", "xsi");
    xml.writeAttribute("xsi:schemaLocation", ns + " " + ns + "/api/v1/NHIS-" + result.type + ".xsd");
    xml.writeStartElement("nhis:header");
    field("sender", "2");
    field("senderId", practice.lpk);
    field("senderISName", "NZIS Spravki " APP_VERSION);
    field("recipient", "4");
    field("recipientId", "NHIS");
    field("messageId", result.id);
    field("messageType", result.type);
    field("createdOn", now.toString(Qt::ISODate));
    xml.writeEndElement();
    xml.writeStartElement("nhis:contents");
    field("identifierType", patient.identifierType);
    field("identifier", patient.identifier);
    if (status) {
        field("fromDate", "2008-01-01");
        field("toDate", now.date().toString(Qt::ISODate));
        field("practiceNumber", practice.registration);
    }
    xml.writeEndElement();
    xml.writeEndElement();
    xml.writeEndDocument();
    if (xml.hasError()) fail(QStringLiteral("Неуспешно създаване на XML заявката."));
    return result;
}

QDomDocument tryParseNhIs(const QByteArray &xml) {
    if (xml.isEmpty() || xml.contains('\0') || xml.contains("<!DOCTYPE"))
        return {};
    // Qt's parser accepts XML 1.0. НЗИС can declare 1.1 for the same UTF-8 payload.
    static const QRegularExpression version11(R"re(\A<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(['"])(1\.1)\1)re");
    const qsizetype bom = xml.startsWith("\xef\xbb\xbf") ? 3 : 0;
    const auto prolog = QString::fromLatin1(xml.constData() + bom, qMin(qsizetype(128), xml.size() - bom));
    const auto version = version11.match(prolog);
    QByteArray readable = xml;
    if (version.hasMatch()) readable.replace(bom + version.capturedStart(2), 3, "1.0");
    // Check structure before Qt constructs any DOM nodes. A byte limit alone
    // does not prevent unbounded destructor recursion (CVE-2026-19248).
    if (readable.size() > 16 * 1024 * 1024) return {};
    const std::unique_ptr<xmlTextReader, decltype(&xmlFreeTextReader)> reader(
        xmlReaderForMemory(readable.constData(), int(readable.size()), nullptr, "UTF-8",
                           XML_PARSE_NONET | XML_PARSE_NOERROR | XML_PARSE_NOWARNING),
        xmlFreeTextReader);
    if (!reader) return {};
    int state;
    while ((state = xmlTextReaderRead(reader.get())) == 1) {
        if (xmlTextReaderDepth(reader.get()) >= 64 ||
            xmlTextReaderNodeType(reader.get()) == XML_READER_TYPE_DOCUMENT_TYPE ||
            xmlTextReaderAttributeCount(reader.get()) > 64) return {};
    }
    if (state != 0) return {};
    QDomDocument document;
    if (!document.setContent(readable, QDomDocument::ParseOption::UseNamespaceProcessing) ||
        document.documentElement().localName() != "message" || document.documentElement().namespaceURI() != ns)
        return {};
    return document;
}

QDomDocument parseNhIs(const QByteArray &xml) {
    if (xml.isEmpty()) fail(QStringLiteral("НЗИС върна празен отговор. Повтори справката."));
    auto document = tryParseNhIs(xml);
    if (document.isNull()) fail(QStringLiteral("НЗИС върна отговор в неочакван формат. Очаква се XML съобщение."));
    return document;
}

QDomElement child(const QDomElement &parent, const QString &name) {
    for (auto node = parent.firstChildElement(); !node.isNull(); node = node.nextSiblingElement())
        if (node.localName() == name && node.namespaceURI() == ns) return node;
    return {};
}

QString value(const QDomElement &parent, const QString &name) {
    return child(parent, name).attribute("value");
}

QString nhisResponseError(const QDomDocument &document) {
    const auto root = document.documentElement();
    const auto type = value(child(root, "header"), "messageType");
    if (!QRegularExpression("\\A[A-Z]099\\z").match(type).hasMatch()) return {};

    QStringList lines{QStringLiteral("НЗИС върна грешка (%1).").arg(type)};
    const auto contents = child(root, "contents");
    for (auto error = contents.firstChildElement(); !error.isNull(); error = error.nextSiblingElement()) {
        if (error.namespaceURI() != ns || error.localName() != "error") continue;

        const auto code = value(error, "type");
        if (QRegularExpression("\\A[A-Z][0-9]{3}\\z").match(code).hasMatch() && lines.size() < 9)
            lines << QStringLiteral("Код %1").arg(code);
    }
    return lines.join('\n');
}

void validateDentalResponse(const QDomDocument &document, const DentalMessage &request) {
    if (const auto rejection = nhisResponseError(document); !rejection.isEmpty())
        fail(rejection);
    const auto root = document.documentElement();
    const auto header = child(root, "header");
    const auto type = value(header, "messageType");
    if (type.isEmpty()) fail(QStringLiteral("В XML отговора на НЗИС липсва типът на съобщението."));
    if (type != request.replyType)
        fail(QStringLiteral("НЗИС върна неочакван тип отговор. Очаква се %1.").arg(request.replyType));
    if (value(header, "messageId") != request.id)
        fail(QStringLiteral("Отговорът на НЗИС е за друга заявка. Повтори справката."));

    const auto contents = child(root, "contents");
    if (type == "D010") {
        if (child(contents, "dentalStatus").isNull())
            fail(QStringLiteral("В отговора на НЗИС липсва денталният статус."));
    } else {
        // The reported total is informational when records are present. Patient
        // identity is verified separately for every returned record.
        if (!child(contents, "results").isNull()) return;
        bool ok = false;
        const auto total = value(contents, "foundNumber").toUInt(&ok);
        if (!ok)
            fail(QStringLiteral("НЗИС не върна записи или валиден общ брой лечения."));
        if (total != 0)
            fail(QStringLiteral("НЗИС съобщи за намерени лечения, но не върна записи за проверка."));
    }
}

void validatePatientIdentity(const QDomDocument &treatments, const PatientQuery &patient) {
    const auto normalize = [](const QString &name) {
        return name.normalized(QString::NormalizationForm_C).simplified().toCaseFolded();
    };
    const auto unavailable = [] {
        fail(QStringLiteral("НЗИС не върна достатъчно пациентски данни за проверка на имената и идентификатора. Справката е блокирана."));
    };
    const auto root = treatments.documentElement();
    if (value(child(root, "header"), "messageType") != "D006" ||
        normalize(patient.first).isEmpty() || normalize(patient.last).isEmpty()) unavailable();
    const auto contents = child(root, "contents");
    bool checked = false;
    for (auto result = contents.firstChildElement(); !result.isNull(); result = result.nextSiblingElement()) {
        if (result.namespaceURI() != ns || result.localName() != "results") continue;
        const auto subject = child(result, "subject");
        const auto name = child(subject, "name");
        const auto first = normalize(value(name, "given"));
        const auto last = normalize(value(name, "family"));
        if (subject.isNull() || first.isEmpty() || last.isEmpty() ||
            value(subject, "identifierType").isEmpty() || value(subject, "identifier").isEmpty()) unavailable();
        if (value(subject, "identifierType") != patient.identifierType ||
            value(subject, "identifier") != patient.identifier ||
            first != normalize(patient.first) || last != normalize(patient.last) ||
            (!normalize(patient.middle).isEmpty() && normalize(value(name, "middle")) != normalize(patient.middle)))
            fail(QStringLiteral("Имената и идентификаторът не съвпадат с пациентските данни, върнати от НЗИС. Провери изписването. Справката е блокирана."));
        checked = true;
    }
    if (!checked) unavailable();
}
