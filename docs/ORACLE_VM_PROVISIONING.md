# Oracle Cloud Free Tier — VM Provisioning Guide

Step-by-step guide to create the Always Free VM that hosts this project. Written so anyone can follow it from a fresh Oracle account to a running Ubuntu server, **without ever incurring charges**.

## Forever-free rules (read first)

| Resource | Always Free limit | What we use |
|---|---|---|
| Ampere A1 compute | 4 OCPU + 24 GB RAM **total across all A1 VMs** | One VM with all 4/24 |
| Block/boot storage | 200 GB total | 100 GB boot volume |
| Object Storage | 20 GB | Documents/media + backups |
| Outbound bandwidth | 10 TB/month | Negligible |

Hard rules:
- **Never upgrade the account to Pay As You Go.** On a Free Tier account no billing is active — non-free resources fail to create instead of charging. Ignore Oracle's upgrade banners.
- The cost estimator shows **list prices and does not subtract Always Free allowances** — a small estimate (e.g. "$2.76/month" for the boot volume) is normal and the real cost is $0, provided every line matches the table above.
- Always Free instances can only be created in the account's **home region** (fixed at signup). Pick a region with Ampere capacity (e.g. Hyderabad, Mumbai).
- Oracle may reclaim Always Free instances idle for 7 days (<20% CPU/network). A health-check cron (see deployment guide) prevents this.

## 1. Account

1. Sign up at cloud.oracle.com → Free Tier. The credit card is for identity verification only; it is not charged.
2. Choose the home region carefully — it cannot be changed later.

## 2. Network (VCN)

1. Console ☰ → Networking → Virtual cloud networks → **Start VCN Wizard**.
2. Choose **"Create VCN with Internet Connectivity"** → name it (e.g. `affinity-vcn`) → accept every default → Create.
   - Do NOT use the plain "Create VCN" form — it makes an empty network with no subnet/internet gateway.
3. Open the VCN → Subnets → open the **public** subnet → copy its **OCID** (`ocid1.subnet...`). You need it for the retry script.
4. Security list: add ingress rules for TCP **80** and **443** from `0.0.0.0/0` (22/SSH exists by default).

## 3. SSH key

Generate a key pair (or reuse one):
- In the instance-creation wizard choose "Generate a key pair for me" and **download both files immediately** — the private key is never shown again.
- Or use an existing key (e.g. from MobaXterm) and provide the `.pub` line.

Keep the private key safe; it is the only way into the server. Never paste it anywhere.

## 4. Create the instance (console method)

Compute → Instances → Create instance:

| Setting | Value |
|---|---|
| Name | `affinity-prod` |
| Image | **Canonical Ubuntu 24.04** (plain, not "Minimal"). aarch64 build is selected automatically once the shape is A1 |
| Shape | **VM.Standard.A1.Flex** (Ampere) → expand the row (▸) → **4 OCPUs / 24 GB**. Must show "Always Free-eligible" |
| Security step | Leave defaults (Shielded/Confidential off) |
| Networking | Existing VCN + **public subnet**; **Assign public IPv4 = ON**; add SSH key |
| Boot volume | Custom size **100 GB**, performance **Balanced (10 VPUs)** — do not raise |
| Review | Compute line must be $0; storage estimate is covered by free 200 GB |

If creation succeeds, skip to step 6.

## 5. "Out of host capacity" — the retry script

Ampere free capacity is scarce in popular regions. Manual retries rarely win; use this loop in **Cloud Shell** (the `>_` icon in the console top bar — OCI CLI is pre-configured there).

Notes:
- Cloud Shell stops when the browser tab closes and can idle-timeout (~20 min) / hard-cap at 24 h. Re-running is always safe.
- The script is **idempotent**: it checks whether the instance already exists (RUNNING or PROVISIONING) before every attempt, so it can never create duplicates.
- It retries only on capacity-type errors; any other error stops the loop and prints the message.
- Best odds: early morning local time (~5–8 AM).

Create the script file (paste the whole block once):

```bash
cat > go.sh << 'EOF'
# ==== EDIT THESE FOUR VALUES ====
TENANCY="ocid1.tenancy.oc1..xxxx"          # profile icon -> Tenancy -> OCID
SUBNET="ocid1.subnet.oc1.<region>.xxxx"    # VCN -> Subnets -> public subnet -> OCID
AD="XXXX:AP-HYDERABAD-1-AD-1"              # availability domain name shown in the create-instance wizard
SSHKEY="ssh-rsa AAAA... your-key-comment"  # contents of your PUBLIC key (.pub) file, one line
# =================================

IMAGE=$(oci compute image list --compartment-id "$TENANCY" \
  --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape "VM.Standard.A1.Flex" --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)
echo "Using image: $IMAGE"

n=0
while true; do
  EXISTING=$(oci compute instance list --compartment-id "$TENANCY" --display-name "affinity-prod" --lifecycle-state RUNNING --query 'data[0].id' --raw-output 2>/dev/null)
  if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
    echo "ALREADY CREATED AND RUNNING - stopping. Instance: $EXISTING"
    break
  fi
  PROV=$(oci compute instance list --compartment-id "$TENANCY" --display-name "affinity-prod" --lifecycle-state PROVISIONING --query 'data[0].id' --raw-output 2>/dev/null)
  if [ -n "$PROV" ] && [ "$PROV" != "null" ]; then
    echo "VM is being created right now - waiting..."
    sleep 60
    continue
  fi
  n=$((n+1))
  echo "--- attempt $n at $(date) ---"
  if oci compute instance launch \
      --availability-domain "$AD" \
      --compartment-id "$TENANCY" \
      --shape "VM.Standard.A1.Flex" \
      --shape-config '{"ocpus":4,"memoryInGBs":24}' \
      --image-id "$IMAGE" \
      --subnet-id "$SUBNET" \
      --assign-public-ip true \
      --display-name "affinity-prod" \
      --metadata "{\"ssh_authorized_keys\":\"$SSHKEY\"}" \
      > /tmp/launch.json 2> /tmp/launch.err; then
    echo "SUCCESS - VM CREATED at $(date)"
    break
  fi
  if ! grep -qi "capacity\|InternalError\|TooManyRequests" /tmp/launch.err; then
    echo "STOPPED - different error (not capacity):"
    cat /tmp/launch.err
    break
  fi
  sleep 90
done
EOF
```

Run it (and re-run any time with the same command):

```bash
bash go.sh
```

Expected output: `--- attempt N ---` every ~90 s while capacity is unavailable; `SUCCESS - VM CREATED` when it lands; `ALREADY CREATED AND RUNNING` if re-run afterwards.

Fallback options if capacity stays unavailable for days:
- Temporarily request a smaller size (edit `"ocpus":4,"memoryInGBs":24` down to 2/12 or 1/6 — still Always Free) and scale up later via Instance → More actions → Edit shape.
- Do **not** switch to a paid shape or upgrade the account.

## 6. After the VM exists

1. Compute → Instances → `affinity-prod` → wait for **Running** → copy the **public IP**.
2. Confirm exactly **one** instance exists; terminate accidental duplicates.
3. Connect: `ssh ubuntu@<PUBLIC_IP>` with the private key (MobaXterm: Session → SSH → Advanced → Use private key).
4. Open the OS firewall (Ubuntu images ship restrictive iptables):
   ```bash
   sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
   sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
   ```
5. Continue with `docs/ORACLE_DEPLOYMENT_GUIDE.md`.
