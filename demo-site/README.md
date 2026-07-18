# RemoteCtrl client domain setup demo

This is a standalone, offline-friendly client portal for the RemoteCtrl hackathon demo. It simulates a technician connecting a domain inside a client’s authenticated browser.

## Run it

From the repository root:

```bash
python3 -m http.server 4173 --directory demo-site
```

Open [http://localhost:4173/index.html](http://localhost:4173/index.html).

No API keys, database, authentication, or external network calls are required.

## Current demo mode

Variant A is currently active for every visit. Variant B is disabled temporarily so the presentation uses one stable domain setup layout.

The active selectors are `#domainName`, `#dnsProvider`, and `#continueButton`.

The alternate Variant B implementation remains in the page source for later re-enablement, but is not selected by the current demo flow.

The old reset URL remains harmless, but is no longer needed:

```text
http://localhost:4173/domain-setup.html?reset=1
```

## Suggested RemoteCtrl workflow

Create or record a workflow with these steps:

1. Navigate to `http://localhost:4173/index.html`.
2. Click the link to open domain setup.
3. Fill `#domainName` with `acme.example`.
   - Description: `Fill the client’s domain name field.`
   - Failure mode: `self_heal`
4. Select `cloudflare` in `#dnsProvider`.
   - Description: `Choose the client’s DNS provider.`
   - Failure mode: `self_heal`
5. Click `#continueButton`.
   - Description: `Continue the domain setup.`
   - Failure mode: `self_heal`
6. Check that the success page is visible.

For the current presentation:

1. Open the dashboard and run the workflow against the stable domain setup page.
2. Complete the domain setup and point out the browser control flow.

The demo proves workflow self-healing only. It does not claim that remote human mouse and keyboard input is scope-enforced.
