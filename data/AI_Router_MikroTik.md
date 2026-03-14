# Router & MikroTik (RouterOS) — Student Study Notes (Markdown Handbook)

> Audience: beginners who have little to no router background  
> Goal: help you learn after class and build solid Router + MikroTik fundamentals  
> Scope: routing/switching basics, MikroTik RouterOS concepts, practical labs, troubleshooting

---

## 1. What is a Router?

A **router** is a network device that forwards packets between different networks.
- It connects **subnets** (Layer 3 / IP) and decides where traffic should go.
- It can also do services like NAT, firewalling, VPN, DHCP, QoS, etc.

### 1.1 Router vs Switch vs Access Point
- **Switch (Layer 2):** forwards frames based on MAC addresses (same subnet / VLAN).
- **Router (Layer 3):** forwards packets based on IP routes (between subnets).
- **Access Point:** bridges wireless clients into a LAN (usually L2 bridging).

### 1.2 Why routers matter
- They define **network boundaries** (subnets/VLANs).
- They provide **security control points** (firewall).
- They enable **internet access** (NAT + default route).
- They support **redundancy** and **traffic engineering** (dynamic routing).

---

## 2. Basic Networking Concepts You Must Know

### 2.1 IP addresses and subnets
- IPv4 example: `192.168.10.15`
- Subnet mask / prefix: `/24` means `255.255.255.0`
- Network: `192.168.10.0/24`
- Broadcast: `192.168.10.255`

**Rule of thumb:**  
Devices in the same subnet can talk directly; different subnets need a router.

### 2.2 Default gateway
- The **default gateway** is the router IP in your subnet.
- Your PC sends “non-local” traffic to the default gateway.

### 2.3 ARP (Address Resolution Protocol)
- ARP maps IPv4 → MAC in a LAN.
- Your PC asks: “Who has 192.168.10.1?”

### 2.4 DNS (Domain Name System)
- DNS maps names → IP addresses.
- Your browser needs DNS to reach `example.com`.

### 2.5 DHCP (Dynamic Host Configuration Protocol)
- Automatically provides IP configuration:
  - IP address
  - subnet mask
  - gateway
  - DNS servers

### 2.6 NAT (Network Address Translation)
- Most homes use private IP ranges:
  - `10.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`
- NAT “translates” private IPs to a public IP.
- MikroTik calls typical NAT for internet: **masquerade**.

### 2.7 MTU and fragmentation (important later)
- MTU = maximum packet size on a link (often 1500).
- VPNs often reduce effective MTU.
- Wrong MTU can cause “some websites don’t load”.

---

## 3. Routing Fundamentals

### 3.1 Routing table
A router has a **routing table** containing entries like:
- Destination prefix (e.g., `10.10.0.0/16`)
- Next hop (gateway) or outgoing interface
- Distance/metric (preference)

### 3.2 Connected routes
When you assign an IP to an interface, the router automatically knows:
- “This subnet is directly connected.”

### 3.3 Static routes
You manually define:
- “To reach network X, go via gateway Y.”

### 3.4 Default route
- `0.0.0.0/0` = route for everything not more specifically known.
- Usually points to your ISP gateway.

### 3.5 Dynamic routing (overview)
Routers can learn routes automatically via protocols:
- OSPF (common in enterprise)
- BGP (internet routing)
- RIP (legacy/rare)

We will focus on fundamentals first, then touch OSPF basics.

---

## 4. Firewall Basics

### 4.1 Why a firewall?
A firewall decides which traffic is allowed or denied.

### 4.2 Common firewall concepts
- **Stateful firewall:** tracks connections (NEW/ESTABLISHED/RELATED).
- **Default deny:** allow only what is needed.
- **Zones:** LAN vs WAN vs DMZ (conceptual separation).

### 4.3 MikroTik firewall chains (key concept)
In RouterOS you will see **chains**:
- **input:** traffic going *to the router itself* (Winbox/SSH/DNS on router)
- **forward:** traffic passing *through* the router (LAN ↔ WAN)
- **output:** traffic generated *by the router* (router pinging, updates)

Understanding input vs forward is one of the most important steps.

---

## 5. Switching & VLAN Fundamentals (for Router People)

Even if you “study routing”, VLANs show up everywhere.

### 5.1 VLAN: Virtual LAN
- A VLAN splits a switch into multiple logical networks.
- VLANs allow segmentation: users, servers, guest, IoT, etc.

### 5.2 Access vs Trunk ports
- **Access port:** carries one VLAN untagged (for PCs).
- **Trunk port:** carries multiple VLANs tagged (between switches/routers/APs).

### 5.3 Inter-VLAN routing
- VLANs are separate networks.
- A router (or L3 switch) is required to route between VLANs.

---

## 6. MikroTik Overview

### 6.1 MikroTik hardware vs RouterOS
- **MikroTik** makes hardware (hEX, RB series, CCR, CRS switches).
- **RouterOS** is the operating system that runs features.
- **RouterBOARD** is the hardware platform name.

### 6.2 Management methods
- **Winbox:** Windows GUI tool (also runs on Wine).
- **WebFig:** web UI in the browser.
- **CLI:** terminal via SSH, serial, or Winbox terminal.

### 6.3 QuickSet vs Manual
- **QuickSet** is for fast basic setups.
- For learning, prefer **manual configuration** so you understand each component.

### 6.4 RouterOS concept: “Everything is a menu”
RouterOS CLI structure:
- `/ip address`
- `/ip route`
- `/ip firewall filter`
- `/interface`
- `/interface vlan`

You typically:
- `print` to view
- `add` to create
- `set` to modify
- `remove` to delete

---

## 7. First-Time Safety Checklist (Do This Always)

Before you change anything:
1. Know how you will regain access (MAC Winbox, serial, safe mode).
2. Export the config:
   - `export file=backup_before_changes`
3. Identify WAN vs LAN ports.
4. If remote: avoid locking yourself out.

### 7.1 Safe Mode
In Winbox terminal:
- Press **Ctrl+X** to toggle Safe Mode
- If you disconnect, changes revert
This saves beginners from self-inflicted outages.

---

## 8. Basic MikroTik Interface Concepts

### 8.1 Ethernet ports
- Usually named `ether1`, `ether2`, etc.
- Many default configs use:
  - `ether1` = WAN
  - others = LAN bridge

### 8.2 Bridge
A **bridge** is like a software switch:
- Put multiple ports in a bridge to create a LAN.
- You assign IP address to the bridge interface (common design).

### 8.3 Interface lists
RouterOS can group interfaces:
- `WAN` list
- `LAN` list
Then firewall/NAT rules can reference these lists.

---

## 9. A Minimal Home/Small-Lab Design

Goal:
- LAN devices get DHCP
- Internet works using NAT
- Router has basic firewall
- DNS works

High-level steps:
1. Create bridge for LAN ports
2. Assign LAN IP to bridge
3. Enable DHCP server on LAN
4. Configure WAN (DHCP client or PPPoE)
5. Add default route (often automatic)
6. Configure NAT masquerade
7. Add firewall filter rules

---

## 10. RouterOS Basics — CLI Cheat Sheet

### 10.1 Navigation
- `/` shows root menus
- `..` goes up a level
- `?` help
- `tab` autocomplete

### 10.2 View configs
- `print`
- `print detail`
- `print terse`

### 10.3 Export config
- `/export`
- `/export file=myconfig`

### 10.4 Backups
Binary backup (restores to same model/version typically):
- `/system backup save name=mybackup`

---

## 11. IP Addressing on MikroTik

### 11.1 Assign an IP address
Example: set LAN IP `192.168.88.1/24` on bridge:
- `/ip address add address=192.168.88.1/24 interface=bridge`

### 11.2 View addresses
- `/ip address print`

### 11.3 Common beginner mistake
Assigning IP to a physical port while using a bridge for LAN.
Pick one design:
- IP on bridge (recommended for multi-port LAN)
- OR IP on a single port (simple point-to-point)

---

## 12. WAN Connectivity

### 12.1 WAN via DHCP (most common)
- `/ip dhcp-client add interface=ether1 disabled=no`

### 12.2 WAN via PPPoE (common DSL)
- `/interface pppoe-client add name=pppoe-out1 interface=ether1 user=... password=... disabled=no`

### 12.3 Verify WAN got IP
- `/ip address print`
- `/ip route print`
- `ping 8.8.8.8`
- `ping google.com` (tests DNS too)

---

## 13. DNS on MikroTik

### 13.1 Use ISP DNS or custom DNS
- `/ip dns set servers=1.1.1.1,8.8.8.8 allow-remote-requests=yes`

`allow-remote-requests=yes` means:
- clients can use router as DNS resolver

### 13.2 Verify DNS
- `resolve google.com`
- `ping google.com`

---

## 14. DHCP Server on LAN

### 14.1 Basic idea
DHCP needs:
- DHCP server instance
- Address pool
- Network parameters (gateway, DNS)

### 14.2 Typical steps (conceptual)
1. Create pool: `192.168.88.10-192.168.88.200`
2. DHCP server on bridge
3. DHCP network set gateway/DNS

### 14.3 Common issues
- Wrong interface (DHCP server on WAN by mistake)
- Pool doesn’t match subnet
- Another DHCP server exists (conflict)

---

## 15. NAT (Masquerade) for Internet Access

### 15.1 Why NAT is needed
Your LAN uses private IPs. Without NAT:
- packets go out but replies may not return correctly.

### 15.2 Standard MikroTik NAT rule
- `chain=srcnat`
- `out-interface-list=WAN`
- `action=masquerade`

### 15.3 NAT troubleshooting
- Check your WAN interface list is correct.
- Check default route exists.
- Check forward firewall allows LAN → WAN.

---

## 16. Firewall Fundamentals on MikroTik

### 16.1 Minimal recommended logic (high level)
**Input chain:**
- Allow established/related
- Allow ICMP (ping) (optional but useful)
- Allow management from LAN only
- Drop everything else

**Forward chain:**
- Allow established/related
- Drop invalid
- Allow LAN → WAN
- Drop WAN → LAN (unless port-forwarded)

### 16.2 Connection states
RouterOS tracks:
- `new`
- `established`
- `related`
- `invalid`

### 16.3 ICMP
ICMP is used for:
- ping
- path MTU discovery
Blocking all ICMP can cause strange issues. Prefer a controlled allow.

---

## 17. Management Access (Winbox/SSH/WebFig)

### 17.1 Best practices
- Do not expose management to the internet.
- Restrict management to LAN/VPN only.
- Use strong passwords, disable unused services.

### 17.2 Services menu
You can enable/disable services:
- `telnet` (usually disable)
- `ftp` (usually disable)
- `www` / `www-ssl`
- `ssh`
- `winbox`
- `api` (usually disable unless needed)

### 17.3 MAC Winbox
Winbox can connect by MAC address on local L2 segment.
Useful when IP settings are wrong.

---

## 18. Bridge, Switching, and Hardware Offload (Concepts)

### 18.1 Bridge VLAN filtering
RouterOS can do VLAN-aware switching using the bridge:
- VLAN tables
- tagging/untagging rules
- trunk/access behavior

### 18.2 Hardware offload
On many MikroTik devices:
- switching can be offloaded to switch chip
- but wrong configuration can force CPU processing
CPU-based bridging can reduce throughput.

### 18.3 Beginner-friendly advice
Start simple:
- one bridge for LAN
- no VLAN filtering until you are comfortable
Then move to VLAN labs.

---

## 19. VLANs on MikroTik (Beginner Roadmap)

### 19.1 Three ways you might see VLANs
1. VLAN interface on top of a physical port (router-on-a-stick)
2. VLAN filtering on a bridge (switch-style)
3. Switch chip VLAN config (hardware-dependent)

### 19.2 Router-on-a-stick idea
- One trunk port to a managed switch
- Multiple VLAN subinterfaces on MikroTik
- Each VLAN gets an IP gateway

### 19.3 Typical beginner VLAN lab
- VLAN 10: Users `192.168.10.0/24`
- VLAN 20: Guest `192.168.20.0/24`
- Block VLAN 20 from reaching VLAN 10 (firewall)
- Allow VLAN 20 to internet only

---

## 20. Routing Between VLANs (Inter-VLAN Routing)

When VLANs are separated into subnets:
- Router routes between them if allowed by firewall.

Key steps:
- IP on each VLAN interface
- DHCP per VLAN (optional)
- Firewall rules controlling inter-VLAN traffic

---

## 21. Wireless on MikroTik (Overview)

MikroTik has different wireless stacks depending on model and RouterOS version:
- legacy wireless package (older)
- newer wireless drivers on some platforms

Beginner concepts:
- SSID
- WPA2/WPA3 security
- channel selection
- 2.4 GHz vs 5 GHz
- roaming (advanced)

---

## 22. VPN Concepts (What You Should Know)

### 22.1 Why VPN
- Secure remote access to LAN
- Site-to-site connections between offices
- Encrypt traffic over the internet

### 22.2 Common VPN types on MikroTik
- WireGuard (modern, fast, simpler)
- IPsec (standard, complex, very common)
- L2TP/IPsec (legacy-ish but still used)
- OpenVPN (supported but can be limited depending on setup)

### 22.3 VPN beginner warning
VPNs often involve:
- routing changes
- firewall rules
- MTU/MSS tuning
Learn basics first, then build VPN labs.

---

## 23. Quality of Service (QoS) / Traffic Shaping (Intro)

Why QoS:
- prevent one user from saturating the link
- improve latency for voice/video

MikroTik tools include:
- Simple Queues (beginner-friendly)
- Queue Trees (advanced)
- PCQ (per-connection queue)

A good first lab:
- limit a test device to 10 Mbps down / 2 Mbps up
- measure with speedtest or iperf

---

## 24. Monitoring and Logging

### 24.1 Tools you will use constantly
- `ping`
- `traceroute`
- `torch` (traffic view on an interface)
- `sniffer` (packet capture)
- `/log print`

### 24.2 Torch
Torch helps you answer:
- Who is consuming bandwidth?
- Which IPs and ports are active?

### 24.3 Graphing
MikroTik can graph:
- interface traffic
- CPU usage
- memory
Good for spotting trends.

---

## 25. Troubleshooting Method (Step-by-Step)

When something “doesn’t work”:
1. Check physical layer
   - link up/down, correct cable, correct port
2. Check IP addressing
   - correct IP/subnet/gateway
3. Check routing table
   - default route exists?
   - specific route exists?
4. Check DNS
   - can you ping IP but not name?
5. Check firewall
   - input vs forward?
   - established/related rules?
6. Check NAT
   - masquerade applies on WAN?
7. Use tools
   - ping from router
   - traceroute
   - torch
   - logs

---

## 26. Typical Beginner Mistakes (and How to Avoid Them)

### 26.1 Confusing input vs forward
- Can’t reach internet? Usually forward chain.
- Can’t reach Winbox/SSH? Input chain.

### 26.2 Wrong interface in rules
- NAT out-interface must be WAN.
- DHCP server must be on LAN.

### 26.3 Multiple DHCP servers
- If you connect another router to LAN, it may run DHCP too.

### 26.4 No default route
- Without `0.0.0.0/0`, internet won’t work.

### 26.5 VLAN tagging mismatch
- Switch expects tagged but router sends untagged (or vice versa).

---

## 27. RouterOS Configuration Style Tips

### 27.1 Use comments
Add comments to rules so future-you understands:
- firewall rules
- NAT rules
- address lists

### 27.2 Use interface lists
Instead of hardcoding `ether1`, use `WAN` list.
Your config becomes portable across devices.

### 27.3 Keep it organized
- Group firewall rules by purpose
- Put “accept established/related” near the top
- Drop rules near the bottom

---

## 28. Security Fundamentals for MikroTik

### 28.1 Update RouterOS
- Security fixes matter.
- Keep stable version, read release notes.

### 28.2 Strong authentication
- strong passwords
- prefer SSH keys for SSH
- disable unused accounts

### 28.3 Disable unneeded services
- telnet off
- ftp off
- api off (unless required)

### 28.4 Firewall the router itself
- restrict input chain to LAN/VPN
- do not allow management from WAN

---

## 29. Backups and Change Management

### 29.1 Before a change
- Export config
- Backup
- Use safe mode if risky
- Make one change at a time

### 29.2 After a change
- Test basic connectivity
- Verify logs
- Document what changed and why

---

## 30. Learning Labs (Progressive)

You learn routers by building and breaking labs safely.

### Lab 1: Basic LAN + WAN
- Create bridge LAN
- LAN IP + DHCP
- WAN DHCP client
- NAT masquerade
- Basic firewall
Outcome: PC gets IP and internet works.

### Lab 2: Two subnets and routing
- LAN1: 192.168.10.0/24
- LAN2: 192.168.20.0/24
- Route between them (connected routes)
- Test ping between subnets
- Add firewall to block LAN2 → LAN1
Outcome: you understand routing + firewall.

### Lab 3: VLAN introduction
- VLAN 10 and VLAN 20
- Trunk to managed switch (or virtual lab)
- DHCP per VLAN
Outcome: VLAN tagging and inter-VLAN routing.

### Lab 4: Port forwarding
- Internal web server at 192.168.10.50
- Forward TCP 80/443 from WAN to that host
- Add firewall restrictions (source IP, etc.)
Outcome: NAT dstnat basics + security.

### Lab 5: Site-to-site VPN (advanced)
- Two MikroTiks
- WireGuard tunnel
- Route LANs over tunnel
Outcome: VPN routing concepts.

---

## 31. Tooling You Should Know

### 31.1 Packet capture
RouterOS sniffer can capture packets:
- filter by interface
- filter by IP/port
Then analyze with Wireshark.

### 31.2 iperf
iperf helps measure throughput and detect bottlenecks.
- speedtest can be misleading; iperf is controlled.

### 31.3 Diagramming
Draw your lab:
- interfaces
- subnets
- VLAN IDs
- default gateway
Even simple drawings remove confusion.

---

## 32. Concept Glossary (Beginner Friendly)

- **Interface:** a port or logical connection (ether1, bridge, VLAN, VPN)
- **Subnet:** a range of IP addresses with a prefix (192.168.1.0/24)
- **Gateway:** router IP used to reach other networks
- **Route:** rule that tells where to send packets
- **NAT:** translation between private and public IPs
- **Firewall:** policy deciding allow/deny
- **VLAN:** separated L2 broadcast domain using tags
- **Trunk:** port carrying multiple VLANs
- **Access port:** port for one VLAN (untagged)
- **MTU:** max packet size on a link
- **MSS clamp:** TCP adjustment to avoid MTU issues (advanced)

---

## 33. Study Plan (Self-Learning)

Week 1:
- IP/subnetting basics
- default gateway, DHCP, DNS
- ping/traceroute practice

Week 2:
- routing table, static routes
- NAT concept + masquerade
- understand input vs forward firewall chains

Week 3:
- bridge vs routed ports
- VLAN basics and tagging
- inter-VLAN routing + firewall segmentation

Week 4:
- monitoring tools: torch, logs, graphs
- QoS basics (simple queues)
- intro VPN (WireGuard concepts)

---

## 34. What to Memorize vs What to Understand

Memorize:
- input/forward/output chain meaning
- private IP ranges
- default route concept
- DHCP basics
- VLAN access vs trunk

Understand:
- how packets flow
- why NAT works
- why firewall state matters
- how routes are selected (most specific prefix wins)

---

## 35. Practical “Packet Flow” Mental Model

When traffic goes from PC → internet:
1. PC sends packet to default gateway (router LAN IP)
2. Router checks firewall (forward chain)
3. Router looks up route (default route to ISP)
4. Router applies NAT (srcnat masquerade)
5. Packet goes out WAN
6. Reply comes back to WAN public IP
7. NAT reverses translation to your PC
8. Firewall allows established connection
9. PC receives reply

If any step is broken, traffic fails.

---

## 36. MikroTik Vocabulary You’ll See in Menus

- **Bridge:** software switch
- **IP → Addresses:** assign IPs
- **IP → Routes:** routing table
- **IP → Firewall:** filter, nat, mangle, raw
- **Tools:** ping, traceroute, torch, sniffer
- **System:** users, packages, scheduler, logs
- **Interfaces:** ethernet, vlan, ppp, wireguard

---

## 37. Minimal “Hardening” Checklist (Beginner Safe)

- Change default admin password
- Create a new admin user, disable default if possible
- Disable MAC-server/neighbor discovery on WAN
- Restrict management to LAN/VPN
- Disable unused services
- Keep RouterOS updated
- Backup/export regularly

---

## 38. Extra Practice Questions (Self-Test)

1. What is the difference between a switch and a router?
2. What does the default route `0.0.0.0/0` mean?
3. Why do we need NAT at home?
4. What is the input chain used for?
5. What happens if DHCP pool doesn’t match your subnet?
6. How do VLANs help security?
7. Why can blocking ICMP break some connections?
8. What is “established/related” and why is it important?

---

## 39. Where to Go Next

After you are comfortable with basics:
- OSPF basics (multi-router labs)
- Advanced firewall (address-lists, layer7, fasttrack)
- WireGuard site-to-site and road-warrior
- VLAN filtering on bridge and performance considerations
- Dual-WAN failover and policy routing
- Central logging and monitoring (Syslog, SNMP)

---

## 40. Final Notes

Learning routers is like learning a musical instrument:
- you must practice repeatedly
- you will break things
- you will learn fastest in a lab where breaking things is safe

Keep your lab documented:
- IP plan
- VLAN IDs
- interface roles
- firewall policy goals

If you want, I can also create:
- a “Hands-on Lab Workbook” with tasks + expected outputs
- a MikroTik “cheat sheet” for common commands
- a set of troubleshooting scenarios you can practice

---
End of document.