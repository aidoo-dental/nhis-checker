#pragma once
#include <QString>
#include <stdexcept>

[[noreturn]] inline void fail(const QString &message) {
    throw std::runtime_error(message.toUtf8().constData());
}
