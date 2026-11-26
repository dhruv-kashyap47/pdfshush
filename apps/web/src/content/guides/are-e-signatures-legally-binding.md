---
title: "E-Signatures: Legally Binding? ESIGN and eIDAS"
description: "ESIGN, UETA and eIDAS in plain terms: what makes an electronic signature enforceable, which documents still need witnesses or notarization, and what to keep."
slug: "are-e-signatures-legally-binding"
category: "Legal & compliance"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - signature
  - fill-sign
relatedGuides: []
faq:
  - "Is an electronic signature legally binding? :: In most countries, yes, when the law allows it and the signer intends to sign. ESIGN in the United States and eIDAS in the European Union both treat a simple electronic signature as valid unless a rule requires more."
  - "When does a signature need a witness or a notary? :: When the document or the filing rule says so: wills, sworn statements, some powers of attorney and some court filings. The requirement comes from the document type, not from the signature being electronic."
  - "What should I keep after signing? :: Keep the final file, the signer name and email, the timestamp, and any audit trail the tool provides. If a dispute is likely, keep the copy you sent as well."
draft: false
---

Someone sends back a contract with a note: "Please print, sign and scan." The deal is small, the parties are in three time zones, and the printer is out of toner. You are fairly sure an electronic signature is fine, but not sure enough to bet the contract on it.

The short answer is that electronic signatures are generally enforceable in the United States, the European Union and the United Kingdom, and have been for years. The longer answer is that enforceability depends on the document, the process you used and the record you kept.

## What the law is actually asking for

Electronic signature law does not create a special kind of signature. It removes the assumption that a signature has to be ink on paper. Once that assumption is gone, the question becomes the ordinary contract question: did this person intend to be bound, and can you prove it?

Four things show up in most legal frameworks, in some form:

- **Intent.** The signer meant to sign and meant to be bound by the document.
- **Consent.** The signer agreed to do business electronically and to receive the record that way.
- **Association.** The signature is linked to the specific document, not floating in an email that could refer to anything.
- **Retention.** Each party can keep an accurate copy of the signed record and the information attached to it.

If your process satisfies those four points and the document is not one of the categories that requires something more, you are usually in good shape.

## ESIGN and UETA in plain terms

The federal ESIGN Act is the national floor in the United States. It says that a signature or record cannot be denied legal effect solely because it is electronic. It also sets conditions: the parties must consent to electronic records, the signer must be able to access and retain the information, and the electronic record must be in a form the recipient can keep.

UETA, the Uniform Electronic Transactions Act, is the state-level counterpart. Most states have adopted it, and it works in a similar way. The details differ at the edges, and a handful of states have their own variations. For a transaction governed by state law, UETA is often the statute a court will look at; for matters touching federal law, ESIGN applies. In practice they overlap, and most commercial e-signature processes are built to satisfy both.

Neither statute requires a specific technology. A typed name at the bottom of an email can be a signature in the right circumstances. So can a drawn mark, a click-to-accept button or a cryptographic certificate. What changes with the technology is not whether a signature is possible, but how much evidence you can produce when someone challenges it.

That is the practical lesson. A typed name is easy to dispute. A completed signing session with an identity check, a timestamp, a document hash and a consent record is hard to dispute.

## eIDAS and the three levels

In the EU, eIDAS sets a common framework for electronic identification and trust services, and it defines three levels of electronic signature:

- **Simple electronic signature (SES).** Data in electronic form attached to or associated with other data, used by the signer to sign. It covers a wide range of everyday methods, from a scanned signature to a click-to-sign workflow.
- **Advanced electronic signature (AES).** Uniquely linked to the signer, capable of identifying the signer, created with data the signer controls, and linked to the signed data so that later changes are detectable.
- **Qualified electronic signature (QES).** An advanced signature created with a qualified signature creation device and backed by a qualified certificate. Within the EU, a QES has an effect equivalent to a handwritten signature.

The UK retained a version of the eIDAS framework after Brexit, with its own trust list and supervisory arrangements. The practical effect for most business documents is similar, but if you are relying on a qualified signature across borders, confirm that the provider's certificate is recognized in the jurisdiction where the document will be used.

For ordinary commercial contracts, an SES or AES is usually enough. QES tends to matter where a member state requires a qualified signature for a specific transaction, or where the parties have agreed to use one as a condition of the deal.

## What usually still needs a witness or a notary

This is where most of the risk lives, and where general statements are dangerous. In the United States, the rules come from state law, and they vary. The categories below are the ones that most often require extra formalities, but you should confirm each one for the relevant state and document type.

- **Wills and codicils.** Most states require witnesses, and many require a notary for a self-proving affidavit. Electronic wills are permitted in some states under specific statutes and not in others.
- **Trusts and some estate documents.** Requirements vary widely, and a document that is valid in one state may fail in another.
- **Deeds and instruments to be recorded.** Recording offices often have their own acceptance rules, and some will not accept an electronically signed deed even where the signature is otherwise valid.
- **Powers of attorney.** Many states require witnesses, a notary or both, and some require a specific statutory form.
- **Certain family law documents and court filings.** Filing systems and judges may impose their own requirements, including wet signatures or specific electronic filing formats.
- **Documents with a statutory writing requirement that names a signature method.** A few transactions specify the technology or the formalities.

For a commercial contract, a vendor agreement or an HR form, an electronic signature is usually fine. For anything that will be probated, recorded or filed with a court, check the rule before you send it.

## What an audit trail should contain

If a signature is challenged, the audit trail is your evidence. A useful record generally includes:

- The signer's name and the email address or phone number the invitation was sent to.
- The time of each action, in a stated time zone, including when the document was viewed, signed and completed.
- The IP address and, where available, the device or browser used.
- The authentication method, such as an email link, a one-time code, a knowledge-based check or an identity document.
- A hash or fingerprint of the document at signing, so you can show the file has not changed since.
- The consent disclosure the signer accepted, with its exact wording and version.
- A completion certificate or summary that ties the signer, the document and the timestamps together.

Keep the certificate with the signed PDF, not in a separate folder that gets lost. If your provider issues a separate certificate, download it at the same time as the signed document and store them together under the same name.

## A practical signing workflow

1. **Confirm the document can be signed electronically.** Check the counterparty's requirements and the formalities for the document type. If a witness or notary is required, plan for it before you send anything.
2. **Confirm the other side accepts e-signature.** A short email is enough. Some organizations still have internal policies that require ink, and it is cheaper to find out now.
3. **Prepare a clean final version.** Remove comments and tracked changes, flatten the layout if needed, and make sure the signature and date fields are in the right places.
4. **Set up the signing order.** Decide who signs first, whether initials are required on each page, and whether the signer needs to fill in name, title and date.
5. **Use a tool that records the session.** [Signature](/tools/signature) lets you place a drawn or typed signature and keep a record of the signing. [Fill & Sign](/tools/fill-sign) is the better choice when the document is a form with fields to complete before signing.
6. **Send, collect and download.** When the last signer finishes, download the completed PDF and the certificate together. Do not rely on a link in an email that may expire.
7. **Store the package.** Put the signed document, the certificate, the consent record and any identity check results in the same matter folder, with the same retention period as a paper original.

## Common mistakes

- **Pasting a signature image and calling it executed.** The image may be a valid signature in some circumstances, but without a record of who placed it and when, you have very little to show if it is disputed.
- **Deleting the audit trail before filing.** Courts and counterparties may want the certificate, not just the signed page. Filing a flattened copy without the record can weaken your position.
- **Assuming all documents are the same.** A vendor agreement and a will do not follow the same rules, even if both are PDFs.
- **Skipping consent language.** If the signer never agreed to receive the record electronically, the retention and consent elements are weaker.
- **Signing for an entity without authority.** A signature binds the person and, if they have authority, the organization. Keep the resolution or delegation that shows the authority.
- **Using an expired or unverified link.** A signing link that was forwarded to a colleague is no longer evidence that the named person signed.
- **Not checking the final PDF.** Fields can shift, pages can reorder and signatures can land on the wrong page. Open the completed file before you archive it.

## When this fails

A signature that fails a challenge usually fails on identity or on record-keeping, not on the shape of the mark. If the signer used a shared mailbox, an unverified link or a device you cannot identify, the evidence is thin. If the completed file was re-saved by three people before it reached you, the hash no longer matches the original.

Some documents cannot be fixed after the fact. If a will required two witnesses and the signing session had none, the electronic signature does not cure the missing formality. If a recording office rejects an electronically signed deed, you may need a wet-ink version and a new recording.

When a counterparty insists on ink, ask why. Sometimes it is a genuine legal requirement; often it is a habit. If it is a habit, a short explanation of ESIGN or eIDAS, with a sample audit trail, usually resolves it.

## Related reading

- [Signature](/tools/signature) — sign a PDF and keep a record of the signing session.
- [Redacting a PDF for Court Filing](/guides/redact-pdf-for-court-filing) — clean the file before it becomes an exhibit.
