import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "../format";
import { formatCents } from "../money";
import type { InvoiceDocument } from "./invoice-data";

const INK = "#20242B";
const TOMATO = "#FF4B37";
const ICE = "#E7F0F6";
const MUTE = "#6B7280";
const LINE = "#E3E5E9";

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 64, paddingHorizontal: 48, fontFamily: "Helvetica", fontSize: 9.5, color: INK, lineHeight: 1.4 },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  label: { fontSize: 7, letterSpacing: 1.2, color: MUTE, textTransform: "uppercase", marginBottom: 3 },
  brandMark: { width: 16, height: 16, borderRadius: 4, backgroundColor: TOMATO, marginRight: 7, alignItems: "center", justifyContent: "center" },
  brandDot: { width: 6, height: 6, borderRadius: 1.5, backgroundColor: "#FFFFFF" },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 15, letterSpacing: 0.2 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 22, letterSpacing: -0.3, lineHeight: 1.15 },
  bold: { fontFamily: "Helvetica-Bold" },
  mute: { color: MUTE },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 6 },
  rule: { borderBottomWidth: 1, borderBottomColor: LINE },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: LINE },
  amount: { width: 130, textAlign: "right" },
  totalBox: { marginTop: 18, backgroundColor: INK, borderRadius: 8, paddingVertical: 16, paddingHorizontal: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footer: { position: "absolute", left: 48, right: 48, bottom: 28, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8, fontSize: 7.5, color: MUTE },
  draft: { position: "absolute", top: 300, left: 90, fontSize: 96, color: "#F1F2F4", fontFamily: "Helvetica-Bold", transform: "rotate(-28deg)" },
});

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginLeft: 22 }}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.bold}>{value}</Text>
    </View>
  );
}

export function InvoicePdf({ doc }: { doc: InvoiceDocument }) {
  const { invoice, billTo, charges, outstanding, company } = doc;
  const hasOutstanding =
    outstanding.priorBalanceCents !== 0 ||
    outstanding.unpaidInvoices.length > 0 ||
    outstanding.lateFees.length > 0 ||
    outstanding.paymentsAndCredits.length > 0;

  return (
    <Document title={`Kaizen Waste Invoice ${invoice.number}`} author={company.name}>
      <Page size="LETTER" style={s.page}>
        {invoice.isDraft && <Text style={s.draft} fixed>DRAFT</Text>}

        {/* 1. Header */}
        <View style={s.between}>
          <View>
            <View style={[s.row, { alignItems: "center" }]}>
              <View style={s.brandMark}><View style={s.brandDot} /></View>
              <Text style={s.brand}>Kaizen Waste</Text>
            </View>
            <Text style={[s.mute, { marginTop: 6 }]}>{company.name}</Text>
            <Text style={s.mute}>{company.remittanceAddress}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.title}>Invoice</Text>
            <Text style={[s.mute, { marginTop: 2 }]}>{invoice.isDraft ? "Draft, not yet issued" : `No. ${invoice.number}`}</Text>
          </View>
        </View>

        <View style={[s.between, { marginTop: 26, paddingBottom: 16 }, s.rule]}>
          <View style={{ maxWidth: 250 }}>
            <Text style={s.label}>Bill to</Text>
            <Text style={s.bold}>{billTo.clientName}</Text>
            <Text style={[s.label, { marginTop: 10 }]}>Property</Text>
            <Text style={s.bold}>{billTo.propertyName}</Text>
            {billTo.addressLines.map((l) => (
              <Text key={l} style={s.mute}>{l}</Text>
            ))}
          </View>
          <View style={s.row}>
            <Meta label="Service month" value={invoice.serviceMonth} />
            <Meta label="Invoice date" value={formatDate(invoice.invoiceDate)} />
            <Meta label="Due date" value={formatDate(invoice.dueDate)} />
          </View>
        </View>

        {/* 2. Current charges */}
        <View style={{ marginTop: 20 }}>
          <Text style={s.sectionTitle}>Current Charges</Text>
          {charges.map((c, i) => (
            <View key={i} style={s.line} wrap={false}>
              <Text style={{ flex: 1, paddingRight: 12 }}>{c.description}</Text>
              <Text style={s.amount}>{formatCents(c.amountCents)}</Text>
            </View>
          ))}
          <View style={[s.between, { paddingVertical: 7 }]}>
            <Text style={s.bold}>This invoice</Text>
            <Text style={[s.amount, s.bold]}>{formatCents(invoice.totalCents)}</Text>
          </View>
        </View>

        {/* 3. Outstanding balance */}
        <View style={{ marginTop: 16, backgroundColor: ICE, borderRadius: 8, padding: 14 }} wrap={false}>
          <Text style={s.sectionTitle}>Outstanding Balance</Text>
          {!hasOutstanding && <Text style={s.mute}>No prior balance. Thank you.</Text>}
          {hasOutstanding && (
            <>
              <View style={[s.between, { paddingVertical: 3 }]}>
                <Text style={s.bold}>Prior balance carried forward</Text>
                <Text style={[s.amount, s.bold]}>{formatCents(outstanding.priorBalanceCents)}</Text>
              </View>
              {outstanding.unpaidInvoices.map((u) => (
                <View key={u.number} style={[s.between, { paddingVertical: 1.5, paddingLeft: 10 }]}>
                  <Text style={s.mute}>
                    Invoice {u.number}, {formatDate(u.date)}{u.disputed ? " (in dispute)" : ""}
                  </Text>
                  <Text style={[s.amount, s.mute]}>{formatCents(u.remainingCents)} remaining</Text>
                </View>
              ))}
              {outstanding.lateFees.map((f, i) => (
                <View key={i} style={[s.between, { paddingVertical: 3 }]}>
                  <Text>{f.description}</Text>
                  <Text style={s.amount}>{formatCents(f.amountCents)}</Text>
                </View>
              ))}
              {outstanding.paymentsAndCredits.length > 0 && (
                <Text style={[s.bold, { marginTop: 6 }]}>Payments and credits received since the last invoice (already reflected above)</Text>
              )}
              {outstanding.paymentsAndCredits.map((p, i) => (
                <View key={i} style={[s.between, { paddingVertical: 1.5, paddingLeft: 10 }]}>
                  <Text style={s.mute}>{formatDate(p.date)}, {p.reference}</Text>
                  <Text style={[s.amount, s.mute]}>{formatCents(p.amountCents)}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        {/* 4. Total amount due */}
        <View style={s.totalBox} wrap={false}>
          <View>
            <Text style={{ color: "#FFFFFF", fontFamily: "Helvetica-Bold", fontSize: 13, lineHeight: 1.2 }}>Total Amount Due</Text>
            <Text style={{ color: "#B9BEC8", fontSize: 8, marginTop: 4 }}>
              Full account balance including this invoice. Due {formatDate(invoice.dueDate)}.
            </Text>
          </View>
          <Text style={{ color: "#FFFFFF", fontFamily: "Helvetica-Bold", fontSize: 26, lineHeight: 1.15 }}>{formatCents(doc.totalAmountDueCents)}</Text>
        </View>

        {/* 5. Remittance */}
        <View style={{ marginTop: 18 }} wrap={false}>
          <Text style={s.label}>How to pay</Text>
          <Text>
            <Text style={s.bold}>Mail checks to: </Text>
            {company.name}, {company.remittanceAddress}
          </Text>
          {doc.showAch && company.achInstructions && (
            <Text style={{ marginTop: 4 }}>
              <Text style={s.bold}>ACH: </Text>
              {company.achInstructions}
            </Text>
          )}
        </View>

        {/* 6. Footer */}
        <View style={s.footer} fixed>
          <Text>
            Payment terms: net {doc.terms.netDays} days. {doc.terms.lateFeeSentence} {company.contactLine}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
