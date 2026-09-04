# OmaPad / omapad name clearance

Status: research note, 2026-09-04

## Conclusion

**Do not rename TapPad to OmaPad.** The name is already in active use by at least three public open-source projects in the Omarchy ecosystem. The closest conflict is not merely a similar name: it is an exact `omapad` project that combines a user-space daemon, `uinput`, a systemd user service, and an Omarchy Quickshell plugin. That overlap is close enough to create immediate user, search, CLI, service, and plugin confusion even before any trademark analysis.

The absence of an exact package in several registries and the absence of an RDAP registration record for several domains do not make the name clear. Those are point-in-time availability observations, not legal clearance or guarantees that a registrar will sell a domain.

## Exact software and Omarchy uses

| Name | Observed use | Relevance to TapPad |
| --- | --- | --- |
| `canerakdas/omapad` | Public MIT project described as a user-space daemon for controlling an Omarchy/Hyprland desktop with a game controller. It reads `evdev`, creates virtual mouse and keyboard input through `uinput`, installs `omapad.service`, and renders an on-screen keyboard and controls through an Omarchy shell plugin. Its manifest ID is `canerakdas.omapad`. ([repository](https://github.com/canerakdas/omapad), [manifest](https://github.com/canerakdas/omapad/blob/main/manifest.json), [service](https://github.com/canerakdas/omapad/blob/main/systemd/omapad.service)) | **Direct conflict.** Same ecosystem, highly overlapping desktop-input purpose, and essentially the same daemon + systemd + Quickshell split. It also occupies the natural `omapad` CLI/service/config vocabulary. |
| `jamespember/omapad` | Public MIT Omarchy scratchpad overlay named **Omapad**. Its documented install command is `omarchy plugin add https://github.com/jamespember/omapad.git --enable`; its manifest ID is `io.github.jamespember.omapad`. ([repository](https://github.com/jamespember/omapad), [manifest](https://github.com/jamespember/omapad/blob/master/manifest.json)) | **Direct ecosystem/name conflict.** The function differs, but Omarchy users already encounter the exact name as an installable shell plugin. |
| `Aayush9029/OmaPad` | Public MIT project named **OmaPad**, described as a native Linux and Omarchy controller for WalkingPad treadmills. It exposes an `omapad` CLI, installs `omapad.service`, and ships an Omarchy bar widget with ID `local.omapad`. ([repository](https://github.com/Aayush9029/OmaPad), [manifest](https://github.com/Aayush9029/OmaPad/blob/main/omarchy/local.omapad/manifest.json), [service](https://github.com/Aayush9029/OmaPad/blob/main/packaging/systemd/omapad.service)) | **Direct ecosystem/technical namespace conflict.** Different hardware target, but the exact product name, CLI, service, and Omarchy widget vocabulary are already used. |

GitHub's repository search for `omapad in:name` returned all three exact-name repositories on 2026-09-04. Repository metadata showed that they were active and recently created or updated, rather than historical abandoned records. ([GitHub repository search API](https://api.github.com/search/repositories?q=omapad%20in%3Aname&per_page=100))

## Other exact and near-exact public uses

- Vietnamese cosmetics vendor COSAN markets a cotton-pad product as **COSAN OMA PAD** and uses `#omapad` in its official product page. This is an exact commercial phrase but a remote product category. ([COSAN product page](https://cosan.vn/shop/hop-bong-tay-trang-cosan/))
- **Omapad** is also a geographic name in Mandaue, Cebu, including Omapad Road. A Philippine government proclamation uses the name in an address. This is not a software-brand conflict, but it reduces search uniqueness. ([Philippine Senate record](https://ldr.senate.gov.ph/executive-issuance/proclamation-no-1968-s-2009))
- Apple Music lists a 2022 song titled **Oma Pad**. This is an exact spaced phrase in entertainment, not software. ([Apple Music](https://music.apple.com/us/album/oma-pad/1643138957?i=1643138965))

## Package and distribution namespaces

Point-in-time queries on 2026-09-04 found no exact `omapad` package in the following registries:

| Registry | Result | Source |
| --- | --- | --- |
| npm | Exact package endpoint returned not found; registry search returned zero results. | [exact package](https://registry.npmjs.org/omapad), [registry search](https://registry.npmjs.org/-/v1/search?text=omapad&size=100) |
| PyPI | Exact project JSON endpoint returned not found. | [PyPI JSON](https://pypi.org/pypi/omapad/json) |
| crates.io | Search API returned zero crates; the exact crate page returned not found. | [crates.io API search](https://crates.io/api/v1/crates?page=1&per_page=10&q=omapad), [crate page](https://crates.io/crates/omapad) |
| RubyGems | Exact gem endpoint returned not found. | [RubyGems API](https://rubygems.org/api/v1/gems/omapad.json) |
| AUR | Official RPC search returned zero packages. | [AUR RPC](https://aur.archlinux.org/rpc/v5/search/omapad) |
| Flathub | No exact app record was returned from the appstream endpoint. | [Flathub API](https://flathub.org/api/v2/appstream/omapad) |

These empty namespaces are weak positive signals only. They can change at any time, and the existing GitHub projects may later publish into them.

## App stores

- Apple's official Search API, queried for `omapad` in the US software catalog on 2026-09-04, returned no app whose title was exactly `OmaPad`/`omapad`. The API uses fuzzy matching and is storefront-specific, so this does not cover every territory or historical listing. ([Apple Search API query](https://itunes.apple.com/search?term=omapad&entity=software&limit=200&country=us))
- A Google Play web search was checked for `omapad`; no exact app title was identified in the returned page. Google does not provide a comparable complete public catalog API, results vary by locale/account, and web-search absence is not authoritative. ([Google Play search](https://play.google.com/store/search?q=omapad&c=apps&hl=en_US&gl=US))

## Domains

The registry RDAP endpoints returned `404` / not found for these exact domains on 2026-09-04:

- `omapad.com` ([Verisign RDAP](https://rdap.verisign.com/com/v1/domain/OMAPAD.COM))
- `omapad.net` ([Verisign RDAP](https://rdap.verisign.com/net/v1/domain/OMAPAD.NET))
- `omapad.org` ([Public Interest Registry RDAP](https://rdap.publicinterestregistry.org/rdap/org/domain/OMAPAD.ORG))
- `omapad.dev` ([Google Registry RDAP](https://pubapi.registry.google/rdap/domain/OMAPAD.DEV))
- `omapad.app` ([Google Registry RDAP](https://pubapi.registry.google/rdap/domain/OMAPAD.APP))

`whois` also returned no matching registration record for `omapad.io` and `omapad.cn`, but those TLDs did not expose a stable authoritative RDAP result through the IANA bootstrap used in this check. A missing registration record is not a purchase guarantee: premium, reserved, blocked, and newly registered states can differ at the registrar.

## Trademark checks and limits

This is **not a legal trademark clearance opinion**.

- The official [USPTO Trademark Search](https://tmsearch.uspto.gov/), [WIPO Global Brand Database](https://branddb.wipo.int/), [EUIPO eSearch](https://euipo.europa.eu/eSearch/), [China National Intellectual Property Administration trademark search](https://sbj.cnipa.gov.cn/sbj/sbcx/), and [IP India Public Search](https://tmrsearch.ipindia.gov.in/tmrpublicsearch/) are interactive systems. Their current interfaces did not provide a reliable, reproducible structured result in this automated pass, so no claim of "no trademark" is made for any jurisdiction.
- A non-official Indian trademark directory reports an exact **OMAPAD** word-mark application, number `970603`, filed in 2000 by Fusion Remedies Pvt. Ltd. for class 5 pharmaceutical preparations and shown by that directory as registered. This is a **lead, not verified primary evidence**; verify the current status and ownership in IP India's official system or through trademark counsel before relying on it. ([secondary record](https://mycorporateinfo.com/proprietor/fusion-remedies-pvt-ltd/369549))
- Trademark risk depends on jurisdiction, goods/services classes, actual use, similarity, and likelihood of confusion. For an open-source Omarchy input project, the three exact-name software uses above are already enough to reject the name on practical community and technical grounds, regardless of whether a registrable mark exists.

## Recommendation

Keep **TapPad** for now or select a more distinctive replacement, then repeat this same check before changing repository metadata, executable names, systemd units, plugin IDs, domains, or public announcements.

A replacement should avoid both `Oma*` + `Pad` constructions and generic `*Pad` names where possible. The strongest candidate will have:

1. no exact or confusingly close Omarchy/Linux input project;
2. an unoccupied CLI, systemd service, configuration directory, and Quickshell plugin ID;
3. workable repository and package namespaces;
4. at least one practical domain; and
5. a proper jurisdiction/class trademark review before substantial promotion.

## Scope and reproducibility

Queries were performed on 2026-09-04. Sources were prioritized in this order: project owners' repositories and manifests, official registry APIs, official app-store search, official domain RDAP, official trademark search portals, and finally a clearly labeled secondary lead where the official trademark interface was not machine-verifiable. Search indexes, app-store catalogs, domain status, repository state, and trademark records can change after that date.
