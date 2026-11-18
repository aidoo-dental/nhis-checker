// Test the production signing flow with a simulated libp11 backend. No token,
// vendor DLL, PIN, or external service is accessed by these tests.
#include "signing.h"
#include <QApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QTemporaryDir>
#include <libp11.h>
#include <cstdio>
#include <stdexcept>
#include <vector>

namespace {
void expect(bool value, const char *message) {
    if (!value) throw std::runtime_error(message);
}
enum class Scenario { AvailableKey, FailedSlots, EmptyFirst, Removed, Login, BadLogin, RefreshedCertificate };
Scenario scenario;
PKCS11_TOKEN token{};
PKCS11_SLOT slot{};
PKCS11_KEY key{};
PKCS11_CERT cert{};
EVP_PKEY *softwareKey = nullptr;
X509 *identity = nullptr;
std::vector<QString> loads;
bool loaded = false, slotsLive = false, authenticated = false;
int unloads = 0, logins = 0, logouts = 0, contexts = 0;

void reset(Scenario next) {
    expect(!loaded && !slotsLive && contexts == 0, "Previous session leaked driver state");
    scenario = next;
    loads.clear();
    unloads = logins = logouts = 0;
    authenticated = false;
    token = {};
    token.secureLogin = true; // Exercise authentication without opening a PIN dialog.
    slot = {};
    slot.token = &token;
}
void expectUnlockFailure(SigningSession &session) {
    bool failed = false;
    try { session.unlock(nullptr, {}); }
    catch (const std::runtime_error &) { failed = true; }
    expect(failed && !session.isOpen(), "Failed unlock must not publish a session");
    expect(!loaded && !slotsLive && contexts == 0, "Failed unlock leaked driver resources");
}
}

// Deliberately link these symbols instead of libp11 for this target.
extern "C" {
PKCS11_CTX *PKCS11_CTX_new() { ++contexts; return new PKCS11_CTX{}; }
void PKCS11_CTX_free(PKCS11_CTX *ctx) { --contexts; delete ctx; }
int PKCS11_CTX_load(PKCS11_CTX *, const char *path) {
    expect(!loaded && !slotsLive, "Driver loaded before previous driver was released");
    const auto name = QDir::fromNativeSeparators(QString::fromLocal8Bit(path));
    // This driver stands in for the crashing IDPrime DLL. Reaching it after
    // the first usable driver is a regression, even if no login has occurred.
    expect(!name.endsWith("idprimepkcs11.dll"), "Probed IDPrime after finding a usable driver");
    loads.push_back(name);
    loaded = true;
    return 0;
}
void PKCS11_CTX_unload(PKCS11_CTX *) {
    expect(loaded && !slotsLive, "Module unloaded before slot release");
    loaded = false;
    ++unloads;
}
int PKCS11_enumerate_slots(PKCS11_CTX *, PKCS11_SLOT **outSlots, unsigned *count) {
    if (scenario == Scenario::FailedSlots && loads.size() == 1) return -1;
    slotsLive = true;
    *outSlots = &slot;
    *count = 1;
    return 0;
}
void PKCS11_release_all_slots(PKCS11_CTX *, PKCS11_SLOT *, unsigned) {
    expect(slotsLive, "Slots released twice");
    slotsLive = false;
    X509_free(cert.x509);
    cert.x509 = nullptr;
}
PKCS11_SLOT *PKCS11_find_token(PKCS11_CTX *, PKCS11_SLOT *, unsigned) { return &slot; }
PKCS11_SLOT *PKCS11_find_next_token(PKCS11_CTX *, PKCS11_SLOT *, unsigned, PKCS11_SLOT *) { return nullptr; }
int PKCS11_enumerate_certs(PKCS11_TOKEN *, PKCS11_CERT **certs, unsigned *count) {
    *certs = &cert;
    if ((scenario == Scenario::EmptyFirst && loads.size() == 1) ||
        (scenario == Scenario::Removed && loads.size() == 2)) {
        *count = 0;
        return 0;
    }
    expect(cert.x509 == nullptr, "Certificate enumeration retained stale driver data");
    cert.x509 = X509_dup(identity);
    *count = 1;
    return 0;
}
PKCS11_KEY *PKCS11_find_key(PKCS11_CERT *candidate) {
    expect(candidate == &cert && candidate->x509 && loaded && slotsLive,
        "Private key lookup used an unloaded certificate");
    return &key;
}
EVP_PKEY *PKCS11_get_private_key(PKCS11_KEY *) {
    if ((scenario == Scenario::Login || scenario == Scenario::BadLogin) && !authenticated) return nullptr;
    if (scenario == Scenario::RefreshedCertificate) {
        // Some drivers replace cached certificates while resolving a key.
        // Signing must keep working with the session's retained reference.
        X509_free(cert.x509);
        cert.x509 = nullptr;
    }
    EVP_PKEY_up_ref(softwareKey);
    return softwareKey;
}
int PKCS11_login(PKCS11_SLOT *, int, const char *pin) {
    expect(pin == nullptr, "Protected authentication should not supply a PIN");
    ++logins;
    if (scenario == Scenario::BadLogin) return -1;
    authenticated = true;
    return 0;
}
int PKCS11_logout(PKCS11_SLOT *) { ++logouts; authenticated = false; return 0; }
}

int main(int argc, char **argv) {
    QApplication app(argc, argv);
    try {
        QTemporaryDir root;
        expect(root.isValid(), "Cannot create temporary driver directory");
        for (const auto &path : {"/System32/eTPKCS11.dll",
                "/OpenSC Project/OpenSC/pkcs11/opensc-pkcs11.dll", "/System32/idprimepkcs11.dll"}) {
            const auto full = root.path() + path;
            QDir().mkpath(QFileInfo(full).absolutePath());
            QFile file(full);
            expect(file.open(QIODevice::WriteOnly), "Cannot create simulated driver file");
        }
        softwareKey = EVP_PKEY_Q_keygen(nullptr, nullptr, "RSA", 2048);
        identity = X509_new();
        expect(softwareKey && identity, "Cannot create test identity");
        X509_set_pubkey(identity, softwareKey);
        X509_gmtime_adj(X509_getm_notBefore(identity), -60);
        X509_gmtime_adj(X509_getm_notAfter(identity), 3600);
        auto *subject = X509_get_subject_name(identity);
        X509_NAME_add_entry_by_txt(subject, "CN", MBSTRING_ASC,
            reinterpret_cast<const unsigned char *>("Test signer"), -1, -1, 0);
        X509_set_issuer_name(identity, subject);
        expect(X509_sign(identity, softwareKey, EVP_sha256()) > 0, "Cannot sign test identity");
        // Initialize OpenSSL/Windows crypto before redirecting driver lookup.
        qputenv("SystemRoot", root.path().toUtf8());
        qputenv("ProgramFiles", root.path().toUtf8());
        for (auto next : {Scenario::AvailableKey, Scenario::FailedSlots, Scenario::EmptyFirst,
                         Scenario::Login, Scenario::RefreshedCertificate}) {
            reset(next);
            SigningSession session;
            session.unlock(nullptr, {});
            expect(session.isOpen() && session.certificateName() == "Test signer", "Session was not opened");
            const size_t expectedLoads = (next == Scenario::FailedSlots || next == Scenario::EmptyFirst) ? 3 : 2;
            expect(loads.size() == expectedLoads, "Wrong number of driver probes/reloads");
            expect(loads.back() == loads[loads.size() - 2], "Did not reload the selected driver");
            expect(logins == (next == Scenario::Login ? 1 : 0), "Unexpected login or repeated PIN attempt");
            if (next == Scenario::RefreshedCertificate)
                expect(session.sign("<check xmlns=\"urn:nhis:test\"/>").contains("SignatureValue"),
                    "Signing failed after the driver released its certificate reference");
            session.close();
            session.close();
            expect(!loaded && !slotsLive && contexts == 0, "Close leaked driver resources");
            expect(logouts == logins, "Logged out a session we did not authenticate");
            expect(unloads == int(loads.size()), "Not every loaded driver was unloaded");
        }
        for (auto next : {Scenario::Removed, Scenario::BadLogin}) {
            reset(next);
            SigningSession session;
            expectUnlockFailure(session);
            expect(loads.size() == 2, "Failed selection probed additional drivers");
            expect(logins == (next == Scenario::BadLogin ? 1 : 0), "Failed PIN was retried");
        }
        X509_free(identity);
        EVP_PKEY_free(softwareKey);
        std::puts("PASS: sequential discovery, first-driver selection, reload, existing key, login and cleanup");
        return 0;
    } catch (const std::exception &error) {
        std::fprintf(stderr, "%s\n", error.what());
        return 1;
    }
}
