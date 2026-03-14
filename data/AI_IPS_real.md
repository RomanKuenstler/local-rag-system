# Information Protection Services – Fundamentals (with realistic examples)

> Target audience: Students who want structured reading after class.  
> Focus: “services” and operational reality—so not only technology, but also processes, roles, and controls.

---

## 1. What are “Information Protection Services”?

Information Protection Services (IPS) are organizational and technical services  
that protect information across its entire lifecycle:  
from creation through storage and processing to deletion.

Typical protection goals (CIA triad):  
- **Confidentiality**  
- **Integrity**  
- **Availability**

Additional goals often relevant in practice:  
- **Authenticity**  
- **Accountability**  
- **Non-repudiation**  
- **Privacy**

**Realistic example:**  
A university processes student data (grades, student IDs).  
IPS here includes access controls, encryption, backups, logging,  
and processes for access and deletion requests.

---

## 2. Threat modeling: What are we actually protecting against?

Protection without a threat model is “a feeling of security,” not security design.

### 2.1 Typical threat actors
- External attackers (cybercriminals, opportunists)  
- Insiders (malicious or careless)  
- Service providers (misconfiguration, supply chain)  
- Automated bots (credential stuffing, scanning)

### 2.2 Typical attack paths
- Phishing → account takeover  
- Misconfiguration (public storage)  
- Weak passwords / password reuse  
- Unpatched systems (known CVEs)  
- Data leakage via shadow IT (private cloud accounts)

**Realistic example:**  
An employee uploads a customer list to a private cloud drive  
to “continue working from home.”  
The drive is accidentally shared publicly → data leak.

---

## 3. Data lifecycle: Where do protection services apply?

A useful model is the data lifecycle:  
1) Create / capture  
2) Classify / label  
3) Store  
4) Use / share  
5) Archive  
6) Delete / destroy

IPS maps controls and services to these phases.

**Realistic example:**  
- During capture: input validation prevents invalid formats.  
- During storage: encryption + access policy.  
- During sharing: DLP rules block sending sensitive content.  
- During deletion: retention rules + secure deletion.

---

## 4. Data classification & labeling

Data classification is the foundation for sizing protections appropriately.

### 4.1 Typical classification levels
- Public  
- Internal  
- Confidential  
- Strictly confidential / secret

### 4.2 What gets classified?
- Documents (PDF, DOCX)  
- Emails and attachments  
- Database tables and fields  
- Log data (can be personal data)  
- Source code (intellectual property)

### 4.3 Labels and metadata
- A label is a visible marker + a machine-readable attribute  
- Metadata enables automated policies (e.g., DLP/IRM)

**Realistic example:**  
An HR department marks documents as “Confidential – HR.”  
When someone tries to send them to an external email recipient,  
the system warns or blocks the send.

---

## 5. Identity & Access Management (IAM) as a protection service

IAM is often the most important “information protection” lever.  
Why? Because most systems ultimately rely on identities for control.

### 5.1 Core terms
- **Authentication**: Who are you?  
- **Authorization**: What are you allowed to do?  
- **Accounting**: What did you do? (logging/auditing)

### 5.2 Authentication factors
- Knowledge: password, PIN  
- Possession: token, smartphone  
- Inherence: biometrics (fingerprint)

### 5.3 MFA / 2FA in practice
- App-based push or TOTP  
- FIDO2/WebAuthn (security keys)  
- SMS is better than nothing, but weaker than app/key approaches

**Realistic example:**  
An attacker obtains password lists from another breach.  
They try them against the university portal (credential stuffing).  
With MFA enabled, the attack fails even if the password is correct.

---

## 6. Access control models

### 6.1 RBAC (Role-Based Access Control)
- Permissions are assigned to roles  
- Users are assigned roles  
- Works well for organizations with stable job profiles

**Example:**  
Role “Teaching Assistant” can grade exercises, but cannot finalize exam grades.

### 6.2 ABAC (Attribute-Based Access Control)
- Decisions are based on attributes  
- Examples: department, location, device type, sensitivity label  
- Flexible but more complex to govern

**Example:**  
“Allow access only if device is compliant AND user is in HR AND data label = HR.”

### 6.3 Least privilege & need-to-know
- Minimum rights needed for the task  
- Time-bound elevation (just-in-time access)

**Realistic example:**  
An admin gets elevated permissions for only 1 hour  
after a ticket is approved (PAM).

---

## 7. Cryptography as a protection service (encryption)

Cryptography protects confidentiality and can support integrity.

### 7.1 Encryption at rest
- Full disk encryption  
- Database encryption  
- Object/storage encryption

**Example:**  
A laptop with research data is stolen.  
With full disk encryption, the data is unreadable without the key.

### 7.2 Encryption in transit
- TLS for web, APIs, email transport  
- VPN for network access (not always required, but often useful)

**Example:**  
Students access the learning portal from public Wi-Fi.  
TLS prevents interception of session cookies.

### 7.3 Key management
- Where are keys stored?  
- Who is allowed to use keys?  
- Rotation, backup, separation of duties

**Example:**  
Data is encrypted, but the key is stored in the same Git repo.  
Once the repo is compromised, encryption becomes ineffective.

---

## 8. Data Loss Prevention (DLP)

DLP aims to prevent or detect leakage of sensitive data.

### 8.1 DLP channels
- Email (outbound)  
- Cloud storage (uploads, sharing)  
- Endpoints (USB, copy/paste, printing)  
- Web (forms, uploads)

### 8.2 DLP mechanisms
- Content inspection (regex, keywords, fingerprints)  
- Context rules (external recipient, unmanaged device)  
- Actions: warn, quarantine, block, log

**Realistic example:**  
An employee tries to email a file containing a list of IBANs to a private address.  
DLP detects the IBAN pattern + external recipient → blocks and notifies security.

---

## 9. Information Rights Management (IRM) / Rights protection

IRM enforces permissions directly on content:  
- “Read-only”  
- “No copy/paste” (often not perfectly enforceable)  
- “No printing”  
- Expiration date  
- Watermarking

**Realistic example:**  
A company shares a “proposal” with a partner.  
Only the partner’s procurement team can open the document,  
and access expires automatically after 14 days.

---

## 10. Backup, restore & ransomware resilience

Backups are an availability and recovery service.

### 10.1 Key terms
- **RPO (Recovery Point Objective)**: How much data loss is acceptable?  
- **RTO (Recovery Time Objective)**: How long can recovery take?

### 10.2 Best practices
- 3-2-1 rule: 3 copies, 2 media types, 1 offsite  
- Immutable backups (cannot be altered)  
- Regular restore tests (otherwise “Schrödinger’s backup”)

**Realistic example:**  
Ransomware encrypts a file server.  
If backups are reachable and deletable, attackers often encrypt/delete them too.  
Immutable/offline backups increase the chance of clean recovery.

---

## 11. Logging, monitoring & auditing

Accountability is essential for protection and compliance.

### 11.1 What should be logged?
- Auth events (success/failure)  
- Privileged actions (admin, policy changes)  
- Access to highly sensitive areas  
- DLP events, malware detections  
- Configuration changes (cloud IAM, firewall, storage ACLs)

### 11.2 SIEM & use cases
- Event correlation  
- Alerting on anomalies  
- Dashboards for incident response

**Realistic example:**  
An account downloads 30,000 records at night,  
though it normally accesses only 50 per day.  
Monitoring flags the behavior as anomalous → alert.

---

## 12. Policy management & governance

Technology without rules does not scale well.  
Governance creates accountability and standardization.

### 12.1 Typical policies
- Data classification and handling  
- Password/MFA policy  
- Acceptable Use policy  
- Mobile device policy (BYOD vs corporate)  
- Logging/retention policy  
- Incident response policy

### 12.2 Roles (examples)
- Data Owner (business responsibility)  
- Data Custodian (IT operations)  
- Security Officer / CISO  
- DPO (Data Protection Officer)  
- Incident Response Lead

**Realistic example:**  
The Data Owner decides that “grade lists” are strictly confidential.  
IT implements controls: only the exam office can access them + encryption + DLP.

---

## 13. Privacy & compliance as drivers

Information protection is often tied to legal requirements:  
- GDPR (personal data)  
- Industry standards (e.g., finance, healthcare)  
- Contractual obligations (NDA, customer security addendum)

### 13.1 Practical requirements
- Data minimization  
- Access limited to authorized parties  
- Deletion/retention concepts  
- Evidence and traceability (audits, logs)

**Realistic example:**  
A company must prove who accessed customer data and when (audit trail).  
Without meaningful logs, this is not achievable.

---

## 14. Cloud-specific aspects

Cloud doesn’t change the goals, but it changes implementation.  
The **shared responsibility model** is key:  
- The cloud provider secures the platform  
- The customer secures configuration, identities, data, and access

### 14.1 Typical cloud risks
- Public storage due to misconfigured ACLs  
- Overly broad IAM roles (“*:*”)  
- Unencrypted data or weak key governance  
- Lack of network segmentation  
- Unmonitored shadow IT SaaS usage

**Realistic example:**  
A storage bucket is accidentally made public.  
Search engines and scanners find such exposures quickly.  
Guardrails, policies, and continuous configuration checks help prevent this.

---

## 15. Zero Trust as a guiding principle

Zero Trust doesn’t mean “trust nobody,”  
it means trust is never assumed broadly,  
but continuously verified.

### 15.1 Core elements
- Strong identity (MFA, device identity)  
- Device posture (compliance, patch level)  
- Least privilege  
- Microsegmentation  
- Continuous evaluation (risk-based access)

**Realistic example:**  
A login from Berlin is normal.  
A login 10 minutes later from another continent is implausible.  
The system requires extra verification or blocks access.

---

## 16. Secure collaboration: Sharing without losing control

Modern work needs sharing, but controlled:  
- External sharing only with rules  
- Expiring links  
- Guest accounts with limited permissions  
- Watermarking for highly sensitive content

**Realistic example:**  
A project team shares documents with external reviewers.  
Only specific people can access them,  
and downloads are logged.

---

## 17. Incident Response (IR) as a protection service

Prevention is important, but never perfect.  
IR provides structured response.

### 17.1 Typical IR phases
- Preparation  
- Detection  
- Containment  
- Eradication  
- Recovery  
- Lessons learned

### 17.2 Relevance for information protection
- Quickly lock compromised accounts  
- Preserve logs for forensics  
- Assess whether data was exfiltrated  
- Communications, and possibly notifications (e.g., privacy)

**Realistic example:**  
Phishing leads to a compromised email account.  
IR: password reset + revoke tokens + enforce MFA + check mail-forwarding rules.

---

## 18. Typical service building blocks in organizations (overview)

An “information protection service catalog” often includes:  
- IAM (SSO, MFA, roles, access reviews)  
- PAM (Privileged Access Management)  
- Encryption services (KMS/HSM, TLS termination)  
- DLP (endpoint/cloud/email)  
- IRM / labeling / classification  
- Backup & recovery  
- SIEM/SOC monitoring  
- Vulnerability & patch management (indirectly highly relevant)  
- Security awareness (phishing training)  
- Data discovery (finding sensitive data)

**Realistic example:**  
A new business unit is onboarded.  
IT enables SSO, role models, labeling policies, DLP, backup, and monitoring as standard services.

---

## 19. Mini case study: Protecting a grades database

### Starting point
A university runs a database containing grades.  
Access is needed by lecturers, the exam office, and IT admins.

### Protection measures as services
- IAM: SSO + MFA for the exam office  
- RBAC: lecturers only see their own courses  
- Encryption: DB at rest + TLS to clients  
- Logging: queries to grade tables are logged  
- DLP: large exports trigger alerts  
- Backup: daily backups + weekly immutable copy  
- IR: playbook “account compromised”  
- Governance: Data Owner = exam office, clear approval processes

### Realistic incident
A lecturer account is compromised via phishing.  
The attacker tries to export grades.  
DLP/monitoring triggers an alert due to unusual export volume.  
The account is locked, logs are analyzed, and password/MFA is reset.

---

## 20. Learning checklist (self-test)

Answer the questions in complete sentences:  
- What is the difference between authentication and authorization?  
- Why is data classification an “enabler” for DLP and IRM?  
- What do RPO and RTO mean in practice?  
- Name three typical cloud misconfigurations that lead to data leaks.  
- Why are restore tests more important than “backup successful” messages?  
- Which logs do you need to prove or disprove data exfiltration?

---

## 21. Small exercises (no special tools required)

### Exercise A: Classification
- Take 10 files from your study context (fictional is fine).  
- Assign them to Public/Internal/Confidential.  
- Justify each in 2–3 sentences.

### Exercise B: Role model
- Design RBAC for a learning platform: Student, TA, Lecturer, Exam Office, Admin.  
- For each role list 5 typical actions and whether allowed/not allowed.

### Exercise C: Incident playbook
- Write a 1-page playbook: “Account compromised.”  
- Include: detection, immediate actions, communication, follow-up.

---

## 22. Common mistakes (and how to avoid them)

- Mistake: “Everything is confidential” → nobody follows it.  
  Fix: few clear classes + automation.

- Mistake: DLP configured only to “block” → frustration and workarounds.  
  Fix: start with monitoring/warnings, then selectively block.

- Mistake: IAM roles too broad (“admin for everything”).  
  Fix: least privilege, PAM, periodic access reviews.

- Mistake: backups without restore drills.  
  Fix: regular restore tests + documented results.

- Mistake: encryption without key governance.  
  Fix: KMS/HSM, rotation, separation of duties.

---

## 23. Mini glossary

- **DLP**: Data Loss Prevention, prevents/detects data leakage.  
- **IRM**: Information Rights Management, enforces rights on the document itself.  
- **KMS**: Key Management Service, manages encryption keys.  
- **HSM**: Hardware Security Module, hardened key storage.  
- **PAM**: Privileged Access Management, controls privileged accounts.  
- **SIEM**: Security Information and Event Management, log correlation/alerting.  
- **Zero Trust**: continuous verification instead of implicit network trust.

---

## 24. Exam-friendly takeaways

Information protection is not “one tool,”  
but an interplay of classification, identity, cryptography,  
monitoring, processes, and governance.

If you keep only one principle:  
**“Know your data, control access, monitor usage, recover fast.”**

End.