import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "../format";
import { formatCents } from "../money";
import { FONT_RETHINK_700, FONT_RETHINK_800, FONT_ROBOTO_FLEX_400, LOGO_ASPECT, LOGO_WHITE_PNG, STAR_TOMATO_PNG } from "./brand-assets";
import type { InvoiceDocument } from "./invoice-data";

// Kaizen brand: Rethink Sans for headlines, Roboto Flex for body.
Font.register({ family: "Rethink", fonts: [{ src: FONT_RETHINK_700, fontWeight: 700 }, { src: FONT_RETHINK_800, fontWeight: 800 }] });
Font.register({ family: "RobotoFlex", src: FONT_ROBOTO_FLEX_400 });
Font.registerHyphenationCallback((word) => [word]);

const MIDNIGHT = "#20242B";
const TOMATO = "#FF4B37";
const ICE = "#E7F0F6";
const MUTE = "#68707D";
const LINE = "#DDE3E9";
const PAD = 44;

const s = StyleSheet.create({
  page: { fontFamily: "RobotoFlex", fontSize: 9.5, color: MIDNIGHT, lineHeight: 1.45, paddingBottom: 52 },
  band: { backgroundColor: MIDNIGHT, paddingHorizontal: PAD, paddingTop: 22, paddingBottom: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center", overflow: "hidden" },
  star: { position: "absolute", width: 230, height: 230, right: -70, top: -95, opacity: 0.16 },
  kicker: { fontFamily: "Rethink", fontWeight: 700, fontSize: 7.5, letterSpacing: 2.2, color: TOMATO, textTransform: "uppercase" },
  bandNumber: { fontFamily: "Rethink", fontWeight: 800, fontSize: 26, color: "#FFFFFF", lineHeight: 1.1, marginTop: 3 },
  metaStrip: { backgroundColor: ICE, paddingHorizontal: PAD, paddingVertical: 11, flexDirection: "row" },
  label: { fontFamily: "Rethink", fontWeight: 700, fontSize: 6.8, letterSpacing: 1.5, color: MUTE, textTransform: "uppercase", marginBottom: 3 },
  strong: { fontFamily: "Rethink", fontWeight: 700 },
  body: { paddingHorizontal: PAD },
  h2: { fontFamily: "Rethink", fontWeight: 800, fontSize: 12.5, lineHeight: 1.2 },
  tableHead: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1.2, borderBottomColor: MIDNIGHT, paddingBottom: 5, marginTop: 9 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, borderBottomWidth: 0.8, borderBottomColor: LINE },
  amount: { width: 120, textAlign: "right" },
  colDesc: { flex: 1, paddingRight: 14 },
  colUnits: { width: 62, textAlign: "right" },
  colRate: { width: 84, textAlign: "right" },
  colTotal: { width: 96, textAlign: "right" },
  mute: { color: MUTE },
  total: { marginTop: 12, backgroundColor: MIDNIGHT, borderRadius: 10, flexDirection: "row", overflow: "hidden" },
  totalBar: { width: 7, backgroundColor: TOMATO },
  footer: { position: "absolute", left: PAD, right: PAD, bottom: 22, borderTopWidth: 0.8, borderTopColor: LINE, paddingTop: 7, fontSize: 7.4, color: MUTE, lineHeight: 1.5 },
  draft: { position: "absolute", top: 330, left: 70, fontSize: 110, color: "#EEF1F4", fontFamily: "Rethink", fontWeight: 800, transform: "rotate(-28deg)" },
});

function Meta({ label, value, grow = 1 }: { label: string; value: string; grow?: number }) {
  return (
    <View style={{ flexGrow: grow, flexBasis: 0 }}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.strong, { fontSize: 10.5 }]}>{value}</Text>
    </View>
  );
}

function SummaryRow({ label, value, sub = false }: { label: string; value: string; sub?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: sub ? 1 : 2.5, paddingLeft: sub ? 10 : 0 }}>
      <Text style={sub ? s.mute : undefined}>{label}</Text>
      <Text style={[{ width: 130, textAlign: "right" }, sub ? s.mute : s.strong]}>{value}</Text>
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
        <View style={s.band}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={STAR_TOMATO_PNG} style={s.star} />
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={LOGO_WHITE_PNG} style={{ width: 132, height: 132 / LOGO_ASPECT }} />
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.kicker}>{invoice.isDraft ? "Draft invoice" : "Invoice"}</Text>
            <Text style={s.bandNumber}>{invoice.isDraft ? "Not yet issued" : `No. ${invoice.number}`}</Text>
          </View>
        </View>
        <View style={s.metaStrip}>
          <Meta label="Service month" value={invoice.serviceMonth} />
          <Meta label="Invoice date" value={formatDate(invoice.invoiceDate)} />
          <Meta label="Due date" value={formatDate(invoice.dueDate)} />
          <Meta label="Terms" value={`Net ${doc.terms.netDays}`} grow={0.6} />
        </View>

        <View style={s.body}>
          <View style={{ flexDirection: "row", marginTop: 15 }}>
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={s.label}>Bill to</Text>
              <Text style={[s.strong, { fontSize: 11.5 }]}>{billTo.clientName}</Text>
            </View>
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={s.label}>Property</Text>
              <Text style={[s.strong, { fontSize: 11.5 }]}>{billTo.propertyName}</Text>
              {billTo.addressLines.map((l) => (
                <Text key={l} style={s.mute}>{l}</Text>
              ))}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>From</Text>
              <Text style={[s.strong, { fontSize: 11.5 }]}>{company.name}</Text>
              <Text style={s.mute}>{company.remittanceAddress}</Text>
            </View>
          </View>

          {/* 2. Current charges */}
          <View style={{ marginTop: 16 }}>
            <Text style={s.h2}>Current Charges</Text>
            <View style={s.tableHead}>
              <Text style={[s.label, s.colDesc, { marginBottom: 0 }]}>Service</Text>
              <Text style={[s.label, s.colUnits, { marginBottom: 0 }]}>Units</Text>
              <Text style={[s.label, s.colRate, { marginBottom: 0 }]}>Rate</Text>
              <Text style={[s.label, s.colTotal, { marginBottom: 0 }]}>Total</Text>
            </View>
            {charges.map((c, i) => (
              <View key={i} style={s.row} wrap={false}>
                <View style={s.colDesc}>
                  <Text style={s.strong}>{c.title}</Text>
                  <Text style={[s.mute, { fontSize: 8.5 }]}>{c.detail}</Text>
                </View>
                <Text style={s.colUnits}>{c.units}</Text>
                <Text style={s.colRate}>{c.rateCents === null ? "" : formatCents(c.rateCents)}</Text>
                <Text style={[s.colTotal, s.strong]}>{formatCents(c.amountCents)}</Text>
              </View>
            ))}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingTop: 9 }}>
              <Text style={[s.label, { marginBottom: 0, marginTop: 2.5 }]}>This invoice</Text>
              <Text style={[s.amount, { fontFamily: "Rethink", fontWeight: 800, fontSize: 12.5 }]}>{formatCents(invoice.totalCents)}</Text>
            </View>
          </View>

          {/* 3. Outstanding balance */}
          <View style={{ marginTop: 12, borderRadius: 10, borderWidth: 0.8, borderColor: LINE, paddingVertical: 11, paddingHorizontal: 16 }} wrap={false}>
            <Text style={[s.h2, { marginBottom: 7 }]}>Outstanding Balance</Text>
            {!hasOutstanding && <Text style={s.mute}>No prior balance on this account. Thank you.</Text>}
            {hasOutstanding && (
              <>
                <SummaryRow label="Prior balance carried forward" value={formatCents(outstanding.priorBalanceCents)} />
                {outstanding.unpaidInvoices.map((u) => (
                  <SummaryRow
                    key={u.number}
                    sub
                    label={`Invoice ${u.number}, ${formatDate(u.date)}${u.disputed ? " (in dispute)" : ""}`}
                    value={`${formatCents(u.remainingCents)} remaining`}
                  />
                ))}
                {outstanding.lateFees.map((f, i) => (
                  <SummaryRow key={i} label={f.description} value={formatCents(f.amountCents)} />
                ))}
                {outstanding.paymentsAndCredits.length > 0 && (
                  <Text style={[s.label, { marginTop: 9 }]}>Payments and credits received since the last invoice (already reflected above)</Text>
                )}
                {outstanding.paymentsAndCredits.map((p, i) => (
                  <SummaryRow key={i} sub label={`${formatDate(p.date)}, ${p.reference}`} value={formatCents(p.amountCents)} />
                ))}
              </>
            )}
          </View>

          {/* 4. Total amount due */}
          <View style={s.total} wrap={false}>
            <View style={s.totalBar} />
            <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, paddingHorizontal: 18 }}>
              <View>
                <Text style={{ fontFamily: "Rethink", fontWeight: 800, fontSize: 14, color: "#FFFFFF", lineHeight: 1.2 }}>Total Amount Due</Text>
                <Text style={{ color: "#AEB6C2", fontSize: 8, marginTop: 3 }}>
                  The full account balance, including this invoice. Due {formatDate(invoice.dueDate)}.
                </Text>
              </View>
              <Text style={{ fontFamily: "Rethink", fontWeight: 800, fontSize: 30, color: "#FFFFFF", lineHeight: 1.1 }}>{formatCents(doc.totalAmountDueCents)}</Text>
            </View>
          </View>

          {/* 5. Remittance, and what is scheduled next */}
          <View style={{ marginTop: 11, flexDirection: "row" }} wrap={false}>
            <View style={{ flex: 1, paddingRight: 14 }}>
              <Text style={s.label}>Pay by check</Text>
              <Text>Mail checks to:</Text>
              <Text style={s.strong}>{company.name}</Text>
              <Text style={s.strong}>{company.remittanceAddress}</Text>
            </View>
            {doc.showAch && company.achInstructions && (
              <View style={{ flex: 1, paddingRight: 14 }}>
                <Text style={s.label}>Pay by ACH</Text>
                <Text>{company.achInstructions}</Text>
              </View>
            )}
            {doc.nextMonth && (
              <View style={{ width: 168, backgroundColor: ICE, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12 }}>
                <Text style={s.label}>Next month, scheduled</Text>
                <Text style={{ fontFamily: "Rethink", fontWeight: 800, fontSize: 14, lineHeight: 1.2 }}>{formatCents(doc.nextMonth.amountCents)}</Text>
                <Text style={[s.mute, { fontSize: 7.6, marginTop: 2 }]}>{doc.nextMonth.label} service, before any one-off work</Text>
              </View>
            )}
          </View>
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
