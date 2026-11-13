// SPDX-License-Identifier: GPL-3.0-only
// PKCS#11 flow adapted from DinoDent, src/Network/PKCS11.cpp.
#include "error.h"
#include "signing.h"
#include "xml_signature.h"
#include "certificate.h"
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QInputDialog>
#include <QLineEdit>
#include <QStringList>
#include <memory>
#include <vector>
#include <libp11.h>
#include <openssl/evp.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>

namespace {
using Certificate = std::unique_ptr<X509, decltype(&X509_free)>;

QStringList defaultDrivers() {
#ifdef Q_OS_WIN
    const auto windows = qEnvironmentVariable("SystemRoot", QStringLiteral("C:/Windows"));
    const auto programs = qEnvironmentVariable("ProgramFiles", QStringLiteral("C:/Program Files"));
    return {windows + "/System32/eTPKCS11.dll",
        programs + "/SafeNet/Authentication/SAC/x64/IDPrimePKCS1164.dll",
        programs + "/OpenSC Project/OpenSC/pkcs11/opensc-pkcs11.dll",
        windows + "/System32/OcsPKCS11Wrapper.dll", windows + "/System32/bit4ipki.dll",
        windows + "/System32/idprimepkcs11.dll", windows + "/System32/cmP11.dll",
        windows + "/System32/cvP11.dll", windows + "/System32/siecap11.dll", windows + "/System32/cmP1164.dll"};
#elif defined(Q_OS_MACOS)
    return {"/Library/Frameworks/eToken.framework/Versions/A/libIDPrimePKCS11.dylib",
        "/Library/OpenSC/lib/opensc-pkcs11.so", "/Library/AWP/lib/libOcsCryptoki.dylib",
        "/Library/Gemalto/libidprimepkcs11.dylib", "/Library/CV Cryptovision/libcvp11.dylib",
        "/Library/bit4id/pkcs11/libbit4ipki.dylib", "/Applications/Charismathics/libcmP11.dylib"};
#else
    return {"/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so", "/usr/lib64/opensc-pkcs11.so"};
#endif
}
} // namespace

struct SigningSession::State {
    PKCS11_CTX *context = PKCS11_CTX_new();
    PKCS11_SLOT *slotList = nullptr;
    unsigned count = 0;
    PKCS11_SLOT *loggedIn = nullptr;
    EVP_PKEY *key = nullptr;
    Certificate certificate{nullptr, X509_free};
    QString name;
    bool loaded = false;
    ~State() {
        EVP_PKEY_free(key);
        if (loggedIn) PKCS11_logout(loggedIn);
        if (slotList) PKCS11_release_all_slots(context, slotList, count);
        if (loaded) PKCS11_CTX_unload(context);
        if (context) PKCS11_CTX_free(context);
    }
};

SigningSession::SigningSession() = default;
SigningSession::~SigningSession() = default;
void SigningSession::close() { state.reset(); }
bool SigningSession::isOpen() const { return bool(state); }
QString SigningSession::certificateName() const { return state ? state->name : QString(); }
QByteArray SigningSession::sign(const QByteArray &xml) const {
    if (!state) fail(QStringLiteral("Избери и отключи сертификат за КЕП."));
    return signEnveloped(xml, state->key, state->certificate.get());
}

void SigningSession::unlock(QWidget *parent, const QString &driver) {
    if (state) return;
    struct Candidate {
        State *module;
        PKCS11_SLOT *slot;
        Certificate cert;
        QByteArray id;
        QString name;
    };
    std::vector<std::unique_ptr<State>> modules;
    std::vector<Candidate> candidates;
    QStringList labels;
    bool driverFound = false;
    bool driverReady = false;
    bool tokenFound = false;
    bool unreadableCertificate = false;
    const auto paths = driver.isEmpty() ? defaultDrivers() : QStringList{driver};
    for (const QString &path : paths) {
        if (!QFileInfo(path).isFile()) continue;
        driverFound = true;
        auto module = std::make_unique<State>();
        if (!module->context || PKCS11_CTX_load(module->context, QFile::encodeName(QDir::toNativeSeparators(path)).constData()) != 0)
            continue;
        module->loaded = true;
        if (PKCS11_enumerate_slots(module->context, &module->slotList, &module->count) != 0) continue;
        driverReady = true;
        for (auto *slot = PKCS11_find_token(module->context, module->slotList, module->count); slot;
             slot = PKCS11_find_next_token(module->context, module->slotList, module->count, slot)) {
            if (!slot->token) continue;
            tokenFound = true;
            PKCS11_CERT *certs = nullptr;
            unsigned count = 0;
            if (PKCS11_enumerate_certs(slot->token, &certs, &count) != 0) continue;
            for (unsigned i = 0; i < count; ++i) {
                auto *cert = certs[i].x509;
                if (!cert || X509_cmp_current_time(X509_get0_notBefore(cert)) >= 0 ||
                    X509_cmp_current_time(X509_get0_notAfter(cert)) <= 0 ||
                    X509_get_signature_nid(cert) == NID_undef) continue;
                const auto usage = X509_get_key_usage(cert);
                if (usage != UINT32_MAX && !(usage & (KU_DIGITAL_SIGNATURE | KU_NON_REPUDIATION))) continue;
                if (!EVP_PKEY_is_a(X509_get0_pubkey(cert), "RSA")) continue;
                const auto name = certificateField(X509_get_subject_name(cert), NID_commonName);
                const auto issuer = certificateField(X509_get_issuer_name(cert), NID_commonName);
                const auto der = tryCertificateDer(cert);
                if (der.isEmpty()) {
                    unreadableCertificate = true;
                    continue;
                }
                const auto fingerprint = QCryptographicHash::hash(der, QCryptographicHash::Sha256).toHex().left(12);
                const QString label = QStringLiteral("%1 · %2 · %3").arg(name, issuer, QString::fromLatin1(fingerprint));
                if (labels.contains(label)) continue;
                if (X509_up_ref(cert) != 1) {
                    unreadableCertificate = true;
                    continue;
                }
                labels << label;
                const QByteArray id(reinterpret_cast<const char *>(certs[i].id), qsizetype(certs[i].id_len));
                candidates.push_back({module.get(), slot, Certificate(cert, X509_free), id,
                                      name.isEmpty() ? label : name});
            }
        }
        if (!candidates.empty() && candidates.back().module == module.get()) modules.push_back(std::move(module));
    }
    if (candidates.empty()) {
        if (!driverFound)
            fail(QStringLiteral("Драйверът за КЕП липсва. Инсталирай драйвера на доставчика или го избери в „Настройки“."));
        if (!driverReady)
            fail(QStringLiteral("Драйверът за КЕП не може да се използва. Провери дали е за архитектурата на приложението."));
        if (!tokenFound)
            fail(QStringLiteral("КЕП токенът не е открит. Включи го и опитай отново."));
        if (unreadableCertificate)
            fail(QStringLiteral("Сертификатът не може да бъде прочетен."));
        fail(QStringLiteral("На токена няма достъпен валиден RSA сертификат за подписване. Провери сертификата в приложението на доставчика."));
    }
    qsizetype selected = 0;
    bool ok = true;
    if (labels.size() > 1) {
        const auto label = QInputDialog::getItem(parent, QStringLiteral("Избор на КЕП"),
            QStringLiteral("Сертификат"), labels, 0, false, &ok);
        if (!ok) fail(QStringLiteral("Изборът на сертификат е отменен."));
        selected = labels.indexOf(label);
    }
    auto &candidate = candidates.at(size_t(selected));
    auto &module = *candidate.module;
    if (candidate.slot->token->userPinLocked)
        fail(QStringLiteral("ПИН-ът на КЕП е блокиран. Използвай приложението на доставчика за отключване."));
    if (candidate.slot->token->secureLogin) {
        if (PKCS11_login(candidate.slot, 0, nullptr) != 0)
            fail(QStringLiteral("Удостоверяването на токена е неуспешно."));
    } else {
        QString input = QInputDialog::getText(parent, QStringLiteral("Отключване на КЕП"),
            QStringLiteral("ПИН за %1").arg(candidate.name), QLineEdit::Password, {}, &ok);
        if (!ok) fail(QStringLiteral("Отключването на КЕП е отменено."));
        if (input.isEmpty()) fail(QStringLiteral("Въведи ПИН на КЕП токена."));
        QByteArray pin = input.toUtf8();
        OPENSSL_cleanse(input.data(), size_t(input.size()) * sizeof(QChar));
        const int result = PKCS11_login(candidate.slot, 0, pin.constData());
        OPENSSL_cleanse(pin.data(), size_t(pin.size()));
        if (result != 0) fail(QStringLiteral("Токенът отказа вход. Провери ПИН-а и оставащите опити."));
    }
    module.loggedIn = candidate.slot;
    // libp11 owns the certificate list and can refresh it when a session changes.
    PKCS11_CERT *certs = nullptr;
    unsigned certCount = 0;
    PKCS11_CERT *selectedCert = nullptr;
    if (PKCS11_enumerate_certs(candidate.slot->token, &certs, &certCount) == 0) {
        for (unsigned i = 0; i < certCount; ++i) {
            const QByteArray id = QByteArray::fromRawData(reinterpret_cast<const char *>(certs[i].id),
                                                          qsizetype(certs[i].id_len));
            if (id == candidate.id && certs[i].x509 && X509_cmp(certs[i].x509, candidate.cert.get()) == 0) {
                selectedCert = &certs[i];
                break;
            }
        }
    }
    if (!selectedCert) fail(QStringLiteral("Сертификатът не може да бъде прочетен."));
    auto *privateKey = PKCS11_find_key(selectedCert);
    if (!privateKey || !(module.key = PKCS11_get_private_key(privateKey)))
        fail(QStringLiteral("Избраният сертификат няма достъпен частен ключ."));
    module.certificate = std::move(candidate.cert);
    module.name = candidate.name;
    for (auto &entry : modules)
        if (entry.get() == &module) { state = std::move(entry); break; }
}
