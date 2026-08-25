# DadoFit - Product & Technical Blueprint

## 1. Product vision

DadoFit turns exercise selection into a game: roll, train, prove it, challenge others and progress.

Phase 1 (V8) is the Individual MVP. Phase 2 adds the shared social and commercial platform without removing the existing workout loop.

Core loop:

```text
Choose difficulty -> Roll -> Exercise -> Evidence -> Complete
                                      |
                                      v
                               Challenge Gymbros
```

Social loop:

```text
Roll -> Send challenge -> Accept -> Submit evidence -> Review -> Reward -> Return challenge
```

## 2. Phase 2 pillars

1. Gymbros: real user relationships.
2. Challenges: user vs user, user vs many, group vs group, gym vs gym and sponsored challenges.
3. Evidence: image/video proof with review states.
4. Competition: XP, seasons, Team Points and Sponsor Points.
5. Economy: DadoCoins as a closed loyalty currency.
6. Rewards: gym subscriptions, supplements, sports brands, products, discounts and experiences.
7. Monetization: ads, sponsored challenges, DadoFit Gym SaaS, marketplace commissions and DadoFit Pro.

## 3. Four value systems

### XP
User progression. XP is not spendable.

### DadoCoins
Closed loyalty currency for users. It is not cryptocurrency, is not cash, has no cash-out and initially has no peer-to-peer transfer.

### Team Points
Competitive score for squads/groups.

### Sponsor Points
Competitive score for gyms, brands and sponsors. The first MVP rule is simple: an approved sponsored completion can award Sponsor Points.

## 4. Challenge actors

A challenge can be created by:

- a user;
- a group;
- an organization;
- the DadoFit system.

Challenge formats are designed to support:

- 1 vs 1;
- 1 vs many Gymbros;
- group vs group;
- gym -> all eligible members;
- public challenge;
- sponsored challenge.

The database uses `challenges` + `challenge_participants` instead of a single challenged user field so the model can scale from 1:1 to mass challenges.

## 5. Evidence lifecycle

```text
INVITED
  -> ACCEPTED
  -> SUBMITTED
  -> APPROVED
```

Alternative terminal states:

```text
DECLINED
REJECTED
EXPIRED
```

DadoCoins, XP, Team Points and Sponsor Points are not awarded merely for uploading evidence. Rewards must be generated after a trusted approval operation.

## 6. Economy integrity

Wallet balance is not edited directly by the browser.

DadoCoins are recorded in:

- `wallets`: cached current balance;
- `wallet_transactions`: auditable ledger.

Every reward operation must use an idempotency key. Repeated processing of the same challenge must not award the same reward twice.

The V9 foundation includes a server-only `grant_wallet_coins` database function. It is not executable by anonymous or authenticated browser clients.

## 7. Organizations

`organizations` is a shared B2B model instead of separate tables for every commercial actor.

Supported initial types:

- gym;
- brand;
- sponsor;
- company;
- other.

Examples:

```text
Gym 1 -> challenge all active members
Gym 2 -> challenge all active members

Approved completions
  -> user DadoCoins / XP
  -> organization Sponsor Points
  -> seasonal leaderboard
```

## 8. Group competition

Users can belong to squads through `groups` and `group_members`.

A group challenge can award Team Points. Seasonal totals live in `group_scores`, while organization competition is represented by `organization_scores`.

## 9. Sponsors and campaigns

A sponsor is modeled as an organization and can own `sponsor_campaigns`.

A sponsored challenge can define:

- reward DadoCoins;
- reward XP;
- Sponsor Points;
- season;
- start/end dates;
- campaign metadata.

The long-term commercial goal is to make sponsorship part of gameplay rather than only display advertising.

## 10. Rewards marketplace

`rewards` can represent:

- discounts;
- products;
- gym passes;
- subscriptions;
- experiences;
- other partner benefits.

`reward_redemptions` records redemptions. Coin deduction will be implemented as a trusted atomic server operation in a later delivery.

## 11. Technical architecture

```text
Browser / PWA
React + Vite
      |
      | HTTPS
      v
Supabase
  |- Auth
  |- PostgreSQL
  |- Storage
  |- Realtime
  `- Edge Functions / trusted RPC

Frontend deployment
Docker + Nginx remains supported.
```

Docker and Supabase are complementary. Docker packages/serves DadoFit; Supabase provides shared cloud state and backend services.

## 12. Environments

### Local frontend
`npm run dev` -> `http://localhost:5175`

### Docker frontend
`docker compose up -d` -> `http://localhost:8781`

### Development backend
Linked Supabase project: DadoFit Development.

Production must use a separate production environment before real users/rewards are launched.

## 13. Security principles

- Never expose database passwords, secret keys or service-role keys in React.
- Frontend uses only the publishable key.
- Row Level Security is enabled for application tables.
- Wallet/progression/score writes are server-owned.
- Evidence bucket is private.
- Evidence rewards are idempotent.
- Browser clients must not be able to arbitrarily award coins, XP or Sponsor Points.

## 14. Storage

Initial buckets:

- `avatars`: public images, user-owned upload folder;
- `challenge-evidence`: private, maximum 50 MB per file, user-owned upload folder.

Cross-user evidence review will use trusted signed URLs/service logic rather than making the evidence bucket public.

## 15. Roadmap

### V8 - Individual MVP
Complete: workout dice, filters, evidence, history, themes, Docker and advertising placements.

### V9 - Social Foundation
Supabase project, schema, RLS, Storage, profiles, Gymbros foundation, groups, organizations, challenge model, wallet, XP and scores.

### V9.1 - Real Auth & Profiles
Migrate local auth to Supabase Auth, profile creation, username/avatar and session migration strategy.

### V10 - Challenge 1 vs 1
Send, accept, submit evidence, review, rewards and return challenge.

### V11 - Squads
Create groups, invitations, roles, group battles and Team Points.

### V12 - Gyms / Organizations
Organization membership, mass gym challenges and Gym vs Gym leaderboards.

### V13 - Sponsors
Sponsored challenges, campaign dashboard, Sponsor Points and sponsor rankings.

### V14 - DadoCoins Rewards
Marketplace, redemptions, partner offers and trusted coin spending.

### V15 - Seasons
Seasonal XP, group rankings, organization rankings and season rewards.

## 16. V9.0 scope boundary

V9.0 creates the cloud foundation but deliberately does not replace the approved V8 UI or local authentication yet.

This lets us verify the schema and security independently. Once this checkpoint is stable, V9.1 will connect real Supabase Auth and Profiles to the existing interface.
