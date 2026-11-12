#pragma once
#include <QByteArray>
#include <QString>
#include <memory>

class QWidget;
class SigningSession {
public:
    SigningSession();
    ~SigningSession();
    SigningSession(const SigningSession &) = delete;
    SigningSession &operator=(const SigningSession &) = delete;
    void close();
    void unlock(QWidget *parent, const QString &driver);
    bool isOpen() const;
    QString certificateName() const;
    QByteArray sign(const QByteArray &xml) const;
private:
    struct State;
    std::unique_ptr<State> state;
};
