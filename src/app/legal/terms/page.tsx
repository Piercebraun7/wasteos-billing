import type { Metadata } from "next";
import { LegalPage, type Section } from "../legal-page";

export const metadata: Metadata = { title: "End User License Agreement · Kaizen Waste billing" };

const sections: Section[] = [
  { heading: "What this agreement covers", body: [
    "The Kaizen Waste billing application (the \"App\") is operated by Kaizen Waste, LLC (\"Kaizen\", \"we\", \"us\"). Kaizen uses the App to prepare, send and track invoices for its waste services, and to keep its accounting records in QuickBooks Online up to date.",
    "This agreement applies to anyone who signs in to the App (\"you\"): Kaizen staff, and customer contacts who are given access to view their own account. By signing in or using the App, you agree to it. If you do not agree, do not use the App.",
  ] },
  { heading: "Your license", body: [
    "We grant you a limited, revocable, non-exclusive, non-transferable license to use the App for its intended purpose: managing Kaizen's billing if you are Kaizen staff, or viewing invoices, balances and payments for your own properties if you are a customer contact.",
    "The App is not sold or offered to the public. Access is by invitation only, and we may end anyone's access at any time.",
  ] },
  { heading: "Accounts and security", body: [
    "You are responsible for keeping your sign-in details private and for everything done under your account. Tell us straight away at invoices@kaizen-waste.com if you believe someone else has used your account.",
    "You may only view or act on information you are authorized to see. Customer contacts may only view the accounts of the properties they manage.",
  ] },
  { heading: "What you may not do", body: [
    "You may not copy, resell, sublicense, reverse engineer or interfere with the App; attempt to reach data that is not yours; use the App to break any law; or use automated tools to collect data from it.",
  ] },
  { heading: "Connection to QuickBooks Online", body: [
    "The App connects to Kaizen's own QuickBooks Online company through Intuit's official connection, with Kaizen's authorization. It reads customers, products, invoices and payments, and creates invoices, so that the App and Kaizen's books agree. It does not connect to any other company's QuickBooks account.",
    "QuickBooks and Intuit are trademarks of Intuit Inc. The App is not endorsed or certified by Intuit. Your use of QuickBooks itself is governed by Intuit's own terms.",
  ] },
  { heading: "Invoices and payments", body: [
    "The App does not take or process payments. Invoices are paid by check or bank transfer outside the App, as stated on each invoice. Amounts, terms and late fees are governed by the service contract between Kaizen and its customer. If the App and that contract disagree, the contract controls.",
  ] },
  { heading: "Ownership", body: [
    "Kaizen owns the App, its design and its content. Customer records in the App belong to Kaizen and the customer they relate to. Nothing in this agreement transfers ownership of anything to you.",
  ] },
  { heading: "Availability and changes", body: [
    "We work to keep the App available and accurate, but it is provided \"as is\" and \"as available\", without warranties of any kind, to the fullest extent the law allows. We may change, suspend or retire any part of it at any time.",
  ] },
  { heading: "Limit of liability", body: [
    "To the fullest extent the law allows, Kaizen is not liable for indirect, incidental, special or consequential damages, or for lost profits or lost data, arising from use of the App. This does not limit any rights or obligations under a signed service contract between Kaizen and its customer.",
  ] },
  { heading: "Ending this agreement", body: [
    "This agreement lasts for as long as you have access. We may end your access at any time, and you may stop using the App at any time. The sections on ownership, liability and governing law continue after it ends.",
  ] },
  { heading: "Governing law", body: [
    "This agreement is governed by the laws of the State of Arizona. Any dispute will be brought in the state or federal courts located in Maricopa County, Arizona.",
  ] },
  { heading: "Changes to this agreement and contact", body: [
    "We may update this agreement. The effective date at the top shows the current version, and continuing to use the App after a change means you accept it.",
    "Questions: Kaizen Waste, LLC, 3459 E Pasadena Ave, Phoenix, AZ 85018, (602) 341-5575, invoices@kaizen-waste.com.",
  ] },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="End User License Agreement"
      effective="November 16, 2026"
      intro="Please read this agreement before using the Kaizen Waste billing application."
      sections={sections}
      other={{ href: "/legal/privacy", label: "Read the Privacy Policy" }}
    />
  );
}
