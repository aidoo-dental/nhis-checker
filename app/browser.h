#pragma once
#include <QJsonObject>
#include <QString>
#include <functional>

class QWidget;
using DesktopHandler = std::function<QJsonObject(const QString &, const QJsonObject &)>;
QWidget *createBrowser(const QString &html, DesktopHandler handler);
QString desktopHtml();

#ifdef Q_OS_MACOS
class QMainWindow;
void addBrowserEditMenu(QMainWindow &window);
#endif
