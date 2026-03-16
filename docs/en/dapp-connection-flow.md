# DApp Connection and SIWE/UCAN Authorization Flow

This document describes the actual flow based on the current code.

## Summary
- First-time connect: the connect page and follow-up JWT/SIWE/UCAN signing page reuse the same approval popup when the sign request follows immediately.
- Returning site: If already authorized, only the SIWE/UCAN signing page appears.
- Wallet locked: An unlock popup appears first (skipped when already unlocked).

> Note: the signing page only appears when the DApp actually sends a signing request (e.g. SIWE/UCAN login message).

## Key Code Pointers
- Unlock flow: `js/background/unlock-flow.js`
- Connect approval: `js/background/account-handler.js` (`handleEthRequestAccounts`)
- Request routing: `js/background/request-router.js`
- Approval UI: `html/approval.html` + `js/app/approval.js`
- UCAN session: `js/background/ucan.js`

## Detailed Flow
1. **DApp requests accounts**  
   Typically `eth_requestAccounts` / `wallet_requestPermissions`.  
   - If locked, `request-router` calls `requestUnlock()` and opens the unlock popup.  
   - After unlocking, connection continues.

2. **Connect approval (Connect page)**  
   `handleEthRequestAccounts` checks whether the site is already authorized:  
   - **Authorized**: returns accounts directly, no connect popup.  
   - **Not authorized**: opens `approval.html?type=connect`.
   - After approval, the popup stays open briefly in a waiting state for the follow-up login/sign request.

3. **SIWE/UCAN signing (Sign page)**  
   When the DApp sends a SIWE/UCAN login message (e.g. `personal_sign`, `eth_sign`, `eth_signTypedData`),  
   the wallet first tries to reuse the same approval popup for the same `origin + tabId`, and switches it to `approval.html?type=sign...` instead of opening a new window.

4. **UCAN session/sign APIs**  
   `yeying_ucan_session` / `yeying_ucan_sign` call `ensureSiteAuthorized` first.  
   If the site is not authorized, it fails — so the connect step must happen first.

## Flowchart (Mermaid)
```mermaid
flowchart TD
  A[DApp calls eth_requestAccounts / wallet_requestPermissions] --> B{Wallet locked?}
  B -- Yes --> C[Open unlock popup popup.html]
  C --> D[Unlocked]
  B -- No --> D
  D --> E{Site already authorized?}
  E -- Yes --> F[Return accounts<br/>no connect popup]
  E -- No --> G[Open connect popup approval.html?type=connect]
  G --> H[User approves]
  H --> H1[Popup stays open<br/>waiting for next login request]
  F --> I[DApp sends SIWE/UCAN sign request?]
  H1 --> I
  I -- No --> J[End]
  I -- Yes --> K[Reuse current approval popup<br/>switch to approval.html?type=sign]
  K --> L[User approves signature]
  L --> M{UCAN session API?}
  M -- Yes --> N[ensureSiteAuthorized<br/>create/use UCAN session]
  M -- No --> O[Complete normal signing flow]
```
