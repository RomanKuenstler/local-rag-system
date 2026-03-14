# Firewall Fundamentals & OPNsense (Beginner-to-Practitioner Notes)
# Version: 1.0
# Audience: Students new to firewalls, learning OPNsense in a company training context
# Goal: Understand core concepts, then apply them hands-on in OPNsense

---

## 1. What a Firewall Is
A firewall is a security control that enforces rules about network traffic.
It decides which traffic is allowed or blocked based on policy.
Modern firewalls can also inspect content and detect threats.
Firewalls can protect networks, hosts, applications, and users.
A firewall is not a magic shield.
A firewall is one layer in a defense-in-depth approach.

---

## 2. Why Firewalls Matter
Networks connect devices that should not fully trust each other.
The internet contains unsolicited and often malicious traffic.
Internal networks can also be dangerous due to compromised devices.
Firewalls reduce attack surface by limiting exposure.
Firewalls help implement segmentation between parts of a network.
Firewalls can enforce least privilege for network access.
Firewalls can log activity for monitoring and incident response.

---

## 3. Key Terminology (Must Know)
**Packet**
A unit of data transmitted over a network.
Packets contain headers (metadata) and a payload (content).

**Flow / Session**
A sequence of packets related to one conversation.
Example: a TCP connection between client and server.

**Stateful Firewall**
Tracks connection state (e.g., TCP handshake).
Allows return traffic automatically for permitted sessions.

**Stateless Firewall**
Evaluates each packet without remembering prior packets.
Less context, often simpler, sometimes faster, but less flexible.

**ACL (Access Control List)**
A set of allow/deny rules.
Often used on routers and some firewalls.

**NAT (Network Address Translation)**
Rewrites IP addresses (and sometimes ports).
Commonly used to share one public IP among many internal devices.

**Port**
A logical number identifying a service on a host.
Examples: 80 (HTTP), 443 (HTTPS), 53 (DNS).

**Protocol**
Rules for communication.
Common examples: TCP, UDP, ICMP.

**Interface**
A network connection point on the firewall.
Examples: WAN, LAN, OPT1, VLAN interfaces.

---

## 4. OSI Model (Practical View)
Layer 1: Physical (cables, radio, optics).
Layer 2: Data Link (Ethernet frames, MAC addresses, VLAN tags).
Layer 3: Network (IP addresses, routing).
Layer 4: Transport (TCP/UDP ports, sessions).
Layer 7: Application (HTTP, DNS, SMTP, etc.).

Most firewall rule writing focuses on Layer 3 and Layer 4.
Some features (proxies, IDS/IPS) can inspect deeper.

---

## 5. Basic Traffic Direction Concepts
Traffic always has a source and destination.
Rules often apply on the interface where traffic enters the firewall.
This is extremely important in OPNsense.
Inbound vs outbound is about perspective.
“Inbound on WAN” usually means traffic entering from the internet.
“Outbound from LAN” usually means traffic from LAN to anywhere.

---

## 6. Default-Deny Philosophy
A strong baseline is “deny by default, allow as needed”.
You explicitly allow required traffic.
Everything else is blocked.
This reduces accidental exposure.
It also forces you to understand application requirements.

---

## 7. TCP vs UDP (Firewall Relevance)
TCP is connection-oriented (SYN, SYN/ACK, ACK).
TCP has state and reliability mechanisms.
UDP is connectionless (no handshake).
UDP-based apps may require careful rule design.
Stateful firewalls can still track UDP “sessions” heuristically.

---

## 8. ICMP (Ping) and Why It Matters
ICMP is used for diagnostics (ping, traceroute).
Blocking all ICMP can break troubleshooting.
Some ICMP types are important for Path MTU Discovery.
A safe approach is to allow necessary ICMP types selectively.

---

## 9. Common Firewall Policy Patterns
Allow LAN to Internet (with restrictions).
Block unsolicited inbound from WAN.
Allow VPN users to specific internal resources.
Segment IoT devices from main user network.
Allow DNS/NTP from clients only to approved servers.
Block “any-to-any” rules unless absolutely necessary.

---

## 10. Introduction to OPNsense
OPNsense is an open-source firewall and routing platform.
It is commonly installed on dedicated hardware or a VM.
It provides a web-based GUI for administration.
It supports stateful firewalling, NAT, VPN, VLANs, and more.
It is often compared to pfSense, but is a separate project.
OPNsense emphasizes frequent updates and a modern UI.

---

## 11. OPNsense Architecture (High Level)
Underlying firewall engine is based on pf (Packet Filter).
Routing is handled by the OS networking stack.
Services like DHCP, DNS, VPN run as daemons.
The GUI writes configuration to structured config files.
Logs are collected and accessible via the UI.

---

## 12. Typical OPNsense Deployment Roles
Edge firewall between LAN and internet.
Internal segmentation firewall between VLANs.
VPN concentrator for remote access and site-to-site.
Transparent filtering bridge (advanced scenarios).
Lab firewall for learning and experimentation.

---

## 13. Planning Your Network Before Configuring
Define what “WAN” and “LAN” are in your environment.
List internal subnets and VLANs.
List required services (DNS, DHCP, NTP, VPN).
Define who should access what (policy matrix).
Decide which logs you want and where they go.
Plan for backups and updates.

---

## 14. Interfaces in OPNsense
WAN is typically the untrusted external interface.
LAN is typically the trusted internal interface.
OPT interfaces can be added for more networks.
VLAN interfaces can be created on top of a physical NIC.
Each interface can have its own IP configuration and rules.

---

## 15. Addressing and Routing Basics
The firewall needs an IP on each connected network.
Clients use the firewall as default gateway.
The firewall routes between networks you define.
For internet access, the firewall uses a default route via WAN.
Static routes may be needed for remote networks.

---

## 16. The OPNsense Web UI (Navigation Map)
Dashboard shows health, interfaces, gateways, and widgets.
Interfaces menu manages IPs, VLANs, assignments.
Firewall menu manages rules, NAT, aliases, schedules.
Services menu includes DHCP, DNS, Unbound, etc.
VPN menu includes IPsec, OpenVPN, WireGuard (if available).
System menu includes firmware updates, backups, users, logs.

---

## 17. First Boot Checklist (Safe Defaults)
Change the default admin password immediately.
Confirm WAN and LAN interfaces are correct.
Confirm LAN IP is what you expect.
Enable DHCP on LAN only if appropriate.
Confirm you can reach the UI from the LAN.
Update firmware after initial access (in maintenance windows).

---

## 18. Firewall Rules: Core Concepts in OPNsense
Rules are evaluated top to bottom within an interface.
First match usually wins (important for order).
Rules apply on the interface where traffic enters the firewall.
A typical LAN rule allows outbound traffic.
WAN usually has no allow rules by default.
Logging can be enabled per rule for visibility.

---

## 19. Rule Components (What You Configure)
Action: Pass / Block / Reject.
Interface: Where the rule is placed.
Direction: In (commonly used).
Protocol: TCP/UDP/ICMP/any.
Source: who initiates the traffic.
Destination: where it goes.
Destination port: which service.
Optional: schedule, gateway, logging, description.

---

## 20. Pass vs Block vs Reject
Pass: allow traffic.
Block: silently drop traffic.
Reject: drop and actively notify (e.g., TCP RST).
Reject is useful for internal troubleshooting sometimes.
Block is common on WAN to avoid giving feedback to scanners.

---

## 21. “Any” Is Dangerous
An “any-any” rule can defeat segmentation.
Avoid “protocol any” unless needed.
Avoid “source any” on internal interfaces unless justified.
Avoid “destination any” when you can target subnets.
Use least privilege: smallest scope that still works.

---

## 22. Aliases (One of the Most Useful Features)
Aliases group IPs, networks, ports, or URLs (depending on type).
Use aliases to simplify rule maintenance.
Example: alias “DNS_SERVERS” = 10.0.0.10, 10.0.0.11
Example: alias “WEB_PORTS” = 80, 443
Aliases reduce repetitive rule edits.

---

## 23. NAT: Why You Need It (Typical Home/SMB)
Internal addresses are usually private RFC1918 space.
The internet routes public addresses, not private.
Outbound NAT rewrites internal source IP to a public WAN IP.
Port translation allows many internal hosts to share one public IP.

---

## 24. Outbound NAT in OPNsense (Conceptual)
Automatic outbound NAT is common and easiest.
Hybrid outbound NAT allows custom rules plus automatic.
Manual outbound NAT is advanced and requires full control.
If outbound NAT is wrong, clients may not reach the internet.

---

## 25. Port Forwarding (Inbound NAT)
Port forwarding exposes an internal service to the internet.
Example: WAN:443 -> 192.168.1.50:443
This increases risk and should be minimized.
Prefer VPN access rather than direct exposure where possible.
Always pair port forwards with strict firewall rules.
Log and monitor exposed services.

---

## 26. NAT Reflection (Hairpin NAT)
NAT reflection allows internal clients to access internal servers using the public IP.
It can be convenient but may add complexity.
Split DNS is often a cleaner solution in larger networks.
Use reflection carefully and test.

---

## 27. Logging and Visibility
If you cannot see traffic, troubleshooting is guesswork.
Enable logging on key rules (especially blocks during testing).
Use Live View to watch firewall decisions in real time.
Use packet capture when you need deep debugging.
Store logs externally if you need long-term retention.

---

## 28. Troubleshooting Mindset (Firewall Edition)
Assume policy is wrong until proven correct.
Confirm basic connectivity (IP, gateway, DNS).
Check the rule location (correct interface?).
Check rule order (first match wins).
Check NAT (outbound NAT, port forwards).
Check routing (is there a return route?).
Check states (existing states may persist after rule changes).
Use logs to identify which rule matched.

---

## 29. States and Why They Matter
Stateful firewalls create a state entry when traffic is allowed.
Return traffic is allowed automatically for that state.
If you tighten rules, old states may still allow flows.
You may need to reset states during testing.
Do not reset all states casually in production.

---

## 30. Example: Basic LAN-to-Internet Rule
Goal: clients in LAN can browse the web.
Rule on LAN interface:
Action: Pass
Source: LAN net
Destination: any
Protocol: TCP
Destination ports: 80, 443
Optionally allow DNS and NTP separately.

Better approach:
Allow only required ports (web, DNS, NTP).
Block everything else by default.

---

## 31. DNS Concepts (Security and Reliability)
DNS translates names to IP addresses.
If DNS is compromised, users can be redirected to attackers.
Use trusted DNS resolvers.
Consider DNS filtering for malware domains.
Control who can query DNS (block direct external DNS).
Log DNS queries when possible (privacy considerations apply).

---

## 32. Unbound DNS in OPNsense (Common Setup)
Unbound can be a recursive resolver for your LAN.
Clients point to the firewall as DNS server.
Unbound performs recursion and caching.
This can improve performance and privacy.
You can also forward to upstream DNS if desired.
You can override DNS entries for internal hosts.

---

## 33. DHCP Basics (In Simple Terms)
DHCP automatically gives clients IP settings.
It provides IP address, subnet mask, gateway, DNS.
OPNsense can run DHCP per interface.
Avoid running multiple DHCP servers in the same network.

---

## 34. VLAN Basics (Practical)OPNsense
A VLAN is a logical network segment on shared physical switches.
VLAN tags separate traffic at Layer 2.
You can create multiple networks on one physical NIC (trunk).
Common VLAN use cases:
Users, servers, management, guest, IoT, VoIP.

---

## 35. VLANs with OPNsense (Common Steps)
Create VLANs on a parent interface.
Assign VLAN interfaces in OPNsense.
Set IP addresses for each VLAN interface.
Enable DHCP if needed per VLAN.
Create firewall rules per VLAN based on policy.
Ensure switches are configured for tagging correctly.

---

## 36. Segmentation: A Simple Policy Example
User VLAN: internet access, limited access to servers.
Server VLAN: only required inbound from user VLAN.
Guest VLAN: internet only, no internal access.
IoT VLAN: limited outbound, no access to user devices.

This reduces lateral movement if one segment is compromised.

---

## 37. VPN Fundamentals
VPN encrypts traffic between endpoints over untrusted networks.
Common goals:
Remote access for users.
Site-to-site connectivity between offices.
Secure management access.
VPN is not the same as “being anonymous”.
VPN is a transport security mechanism.

---

## 38. VPN Types in OPNsense (Overview)
IPsec: common for site-to-site, also supports remote access.
OpenVPN: widely used, flexible, user-friendly.
WireGuard: modern, fast, simpler model (availability depends on platform/support).
Choose based on requirements, interoperability, and company standards.

---

## 39. Remote Access VPN: Common Best Practices
Use strong authentication (certificates + MFA if possible).
Restrict VPN users to necessary networks only.
Use separate VPN address pools.
Log VPN connections and authentication events.
Harden the VPN service exposed on WAN.
Keep OPNsense updated.

---

## 40. Certificate Basics (Needed for Many VPNs)
Certificates bind an identity to a key pair.
A CA (Certificate Authority) signs certificates.
Clients verify the signature to trust a certificate.
Protect private keys.
Rotate certificates when compromised or expired.

---

## 41. IDS/IPS Concepts (Intro)
IDS: Intrusion Detection System (alerts on suspicious traffic).
IPS: Intrusion Prevention System (blocks suspicious traffic).
Signature-based detection looks for known patterns.
Behavior-based methods can detect anomalies.
False positives can disrupt business.
Start in IDS mode (alert-only), tune, then consider IPS.

---

## 42. Suricata in OPNsense (Common IDS/IPS Engine)
OPNsense can integrate Suricata for IDS/IPS.
You select interfaces to inspect.
You choose rulesets and policies.
You tune rules to reduce false positives.
Monitor performance impact (CPU, RAM).
Treat IDS/IPS as a project, not a checkbox.

---

## 43. Web Proxy and Filtering (Conceptual)
A proxy can mediate web traffic for control and caching.
It can enforce policies like URL filtering (depending on setup).
TLS inspection is complex and has privacy/legal implications.
Many organizations prefer endpoint agents or DNS filtering instead.
If you deploy a proxy, document and communicate clearly.

---

## 44. High Availability (HA) Concepts
HA keeps firewall service running if one device fails.
Often involves two firewalls in a cluster.
Requires shared state synchronization.
Requires careful network design (VIPs, CARP-like concepts).
Test failover regularly.
Document recovery procedures.

---

## 45. Backups and Configuration Management
Export OPNsense configuration regularly.
Store backups securely (treat as sensitive).
Use versioning if possible.
Document changes and why they were made.
Prefer small, controlled changes over big jumps.
Have a rollback plan.

---

## 46. Updates and Patch Management
Security appliances must be updated.
But updates can also introduce changes.
Schedule maintenance windows.
Read release notes when available.
Backup before updating.
Validate key services after updating (WAN, VPN, DNS, DHCP).

---

## 47. User Management in OPNsense
Use named accounts, not shared admin.
Assign least privilege roles if possible.
Use strong passwords and MFA if supported.
Disable unused accounts.
Log administrative actions if possible.

---

## 48. Hardening the Management Interface
Restrict GUI access to management networks only.
Avoid exposing GUI on WAN.
Use HTTPS for the GUI.
Use strong TLS settings where possible.
Consider management via VPN only.
Monitor login attempts.

---

## 49. Time and NTP (Often Overlooked)
Correct time is essential for logs and certificates.
Use NTP for accurate time.
Ensure firewall itself can reach NTP servers.
Optionally provide NTP to clients.
Validate timezone settings.

---

## 50. Common Pitfalls (Beginner Mistakes)
Putting rules on the wrong interface.
Allowing “any-any” for quick fixes and forgetting to remove it.
Forgetting DNS rules and thinking “internet is down”.
Not understanding rule order.
Breaking access to the firewall GUI by locking down too early.
Using port forwards when VPN would be safer.
Not checking logs and guessing.

---

## 51. A Safe Learning Lab Setup
Use a VM or spare device for OPNsense.
Create at least two internal networks (LAN and a second VLAN/OPT).
Use a test client VM on each network.
Add a simple server VM (web server or SSH).
Practice rules and observe logs.
Snapshot VMs before risky changes.

---

## 52. Step-by-Step Practice Exercises (Guided)
### Exercise 1: Identify Interfaces
Open OPNsense UI.
List all interfaces and their IPs.
Confirm which is WAN and which is LAN.

### Exercise 2: Confirm Basic Connectivity
From a LAN client, ping the firewall LAN IP.
From the firewall, ping an internet IP (if allowed).
Test DNS resolution from the client.

### Exercise 3: Implement Least-Privilege Outbound
Remove any broad “LAN net to any” allow rule (in the lab only).
Add rules:
Allow LAN net -> firewall (DNS if Unbound is on firewall).
Allow LAN net -> any (TCP 80, 443).
Allow LAN net -> approved NTP servers (UDP 123).
Block and log everything else.
Test browsing.
Check logs for blocked traffic and analyze.

### Exercise 4: Create Aliases
Create alias “ALLOWED_WEB_PORTS” = 80, 443.
Update the web rule to use the alias.
Create alias “PRIVATE_NETS” for RFC1918 ranges (if needed).
Use aliases to make rules more readable.

### Exercise 5: VLAN Segmentation
Create VLAN 10 “GUEST”.
Assign interface and set IP, e.g., 10.10.10.1/24.
Enable DHCP for VLAN 10.
Rules for GUEST:
Allow DNS to firewall.
Allow web (80/443) to internet.
Block access to LAN subnet.
Test from a guest client.

### Exercise 6: Observe States
Create a permitted web connection from a client.
Look at the states table.
Identify source, destination, ports, and state.

---

## 53. Rule Design Checklist (Before You Click Save)
Is the rule on the correct interface?
Is the source correct (host vs subnet)?
Is the destination too broad?
Are ports limited to what is required?
Is logging enabled where it helps?
Is the description clear and specific?
Does rule order make sense?
Have you considered return traffic (stateful behavior)?
Do you need NAT or routing changes?

---

## 54. Documentation Habits (Professional Skill)
Write a short description for every rule.
Use consistent naming for aliases and interfaces.
Keep a simple network diagram updated.
Record change dates and reasons.
Export config backups before major changes.
When something breaks, write a brief post-mortem.

---

## 55. Practical Reference: Common Ports
HTTP: TCP 80
HTTPS: TCP 443
DNS: UDP/TCP 53
NTP: UDP 123
SSH: TCP 22
SMTP: TCP 25 (mail transfer)
IMAPS: TCP 993
RDP: TCP 3389
SIP (VoIP): UDP/TCP 5060 (varies)
Always validate application requirements in real deployments.

---

## 56. Security Principles to Remember
Least privilege beats convenience.
Segmentation reduces blast radius.
Logging enables learning and incident response.
Change control prevents accidental outages.
Backups turn disasters into inconveniences.
Updates reduce known vulnerabilities.
Clarity and documentation scale your work.

---

## 57. Quick “Mental Model” of OPNsense Packet Handling
Traffic enters an interface.
Firewall rules on that interface are evaluated.
If allowed, a state is created (for stateful behavior).
NAT may rewrite addresses depending on direction and rules.
Routing determines the next hop.
Traffic leaves via an egress interface.
Return traffic matches the state and is allowed automatically.

---

## 58. What to Learn Next (A Study Path)
Understand routing and subnetting deeply.
Learn VLAN trunking and switch configuration basics.
Study DNS in more detail (recursive vs forwarding, security).
Practice reading logs and packet captures.
Learn one VPN technology well (OpenVPN or IPsec).
Explore IDS/IPS tuning and false positive handling.
Learn about certificates and PKI fundamentals.
Study incident response basics (containment, evidence, timelines).

---

## 59. Mini Glossary (Fast Reminders)
Default gateway: where traffic goes when destination is unknown locally.
Subnet: a logical IP network range.
CIDR: notation like /24 describing subnet size.
Gateway: route to another network, often the internet.
DMZ: network segment for exposed services (use with care).
East-West traffic: internal lateral traffic.
North-South traffic: traffic between internal and external networks.

---

## 60. Final Notes for Students
Treat firewall work as policy engineering.
Every rule is a security decision.
Start strict in the lab to learn.
Be cautious in production and change gradually.
Measure outcomes with logs and tests.
When in doubt, simplify and verify step by step.

---

# End of Document