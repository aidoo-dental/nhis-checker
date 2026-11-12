#pragma once
#include <QByteArray>

struct evp_pkey_st;
struct x509_st;

// The enveloped XMLDSig/XAdES layout follows DinoDent (GPL-3.0).
QByteArray signEnveloped(const QByteArray &xml, evp_pkey_st *key, x509_st *cert);
