import type { Metadata } from "next";
import { LegalPage, type Section } from "../legal-page";

export const metadata: Metadata = { title: "Privacy Policy · Kaizen Waste billing" };

const sections: Section[] = [
  { heading: "Who we are", body: [
    "The Kaizen Waste billing application (the \"App\") is operated by Kaizen Waste, LLC (\"Kaizen\", \"we\", \"us\"), 3459 E Pasadena Ave, Phoenix, AZ 85018. Kaizen uses the App to bill its own customers for waste services. This policy explains what information the App holds, why, and who can see it.",
  ] },
  { heading: "Information the App holds", body: [
    "Business contact details: the names and work email addresses of the people at a property or management company who receive its invoices.",
    "Billing records: property names and addresses, contract rates and terms, invoices, credits, payments recorded against invoices, and account balances.",
    "Sign-in details: the email address and an encrypted password for each person with access, held by our sign-in provider. We cannot see passwords.",
    "Activity records: a log of changes made in the App and of emails it sends, including whether an email was delivered.",
    "The App is a business tool. It is not designed to collect information about residents or consumers, and it does not collect payment card numbers or customers' bank account details.",
  ] },
  { heading: "Information from QuickBooks Online", body: [
    "With Kaizen's authorization, the App connects to Kaizen's own QuickBooks Online company through Intuit's official connection. It reads the customer list, the product list, invoices, and payments received, and it creates invoices there. This is used only to keep the App and Kaizen's accounting records in agreement.",
    "Information obtained from QuickBooks is not sold, is not used for advertising, and is not shared with anyone other than the service providers listed below, who need it to run the App. The connection can be removed at any time from the App's settings or from within QuickBooks, after which the App can no longer read from or write to QuickBooks.",
  ] },
  { heading: "How we use information", body: [
    "To prepare, send and track invoices, reminders and rate notices; to show what is owed and what has been paid; to keep Kaizen's books accurate; to answer billing questions; to keep the App secure; and to meet legal, tax and accounting obligations. We do not sell personal information and we do not use it for advertising.",
  ] },
  { heading: "Who can see it", body: [
    "Authorized Kaizen staff can see all billing records. A customer contact who is given access can see only the accounts of their own properties.",
    "We use a small number of service providers to run the App, each acting on our instructions: Supabase (database and sign-in), Vercel (hosting), Resend (sending email), Intuit (QuickBooks Online), and Anthropic (the built-in assistant that Kaizen staff use to look up billing records; the records needed to answer a question are sent to it for that purpose only, and are not used to train its models). We may also disclose information when the law requires it, or as part of a sale or reorganization of the business.",
  ] },
  { heading: "How it is protected", body: [
    "Access requires signing in, and each person sees only what their role allows. Information is encrypted in transit and at rest by our hosting and database providers. Financial entries and the activity log are kept so that they cannot be edited after the fact. No system is perfectly secure, and we cannot guarantee absolute security, but we will notify affected parties of a breach as the law requires.",
  ] },
  { heading: "How long we keep it", body: [
    "Billing and accounting records are kept for as long as Kaizen serves the customer and afterwards for as long as tax, accounting and legal rules require, generally seven years. Contact details are removed or updated on request when a person no longer handles billing for a property.",
  ] },
  { heading: "Cookies", body: [
    "The App uses only the cookies needed to keep you signed in and to connect securely to QuickBooks. It does not use advertising or tracking cookies.",
  ] },
  { heading: "Your choices", body: [
    "You can ask to see, correct or remove your contact details by writing to invoices@kaizen-waste.com. We will respond within 30 days. Some records, such as issued invoices, must be kept as described above. Depending on where you live, you may have additional rights under local law, and we will honor them.",
  ] },
  { heading: "Children", body: [
    "The App is for business use and is not directed to anyone under 18.",
  ] },
  { heading: "Changes and contact", body: [
    "We may update this policy. The effective date at the top shows the current version.",
    "Questions or requests: Kaizen Waste, LLC, 3459 E Pasadena Ave, Phoenix, AZ 85018, (602) 341-5575, invoices@kaizen-waste.com.",
  ] },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      effective="November 16, 2026"
      intro="This policy describes how the Kaizen Waste billing application handles information."
      sections={sections}
      other={{ href: "/legal/terms", label: "Read the End User License Agreement" }}
    />
  );
}
