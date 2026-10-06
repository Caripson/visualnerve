# saxes 6.0.0 license fallback

The npm package for saxes 6.0.0 omits its upstream LICENSE file. This directory keeps an unchanged offline copy for production notices. `scripts/licenses.mjs` uses it only for saxes 6.0.0 when the installed package has no license/notice files; other package versions and packages retain their usual behavior.

Verified on 2026-10-06 against the primary [v6.0.0 tag](https://github.com/lddubeau/saxes/tree/v6.0.0), which resolves to commit `211fa0ebec9b628affc09219199639887174bfc3`. The original [LICENSE at that commit](https://github.com/lddubeau/saxes/blob/211fa0ebec9b628affc09219199639887174bfc3/LICENSE) includes the current ISC terms and upstream historical notices; the entire file is retained.

LICENSE SHA-256: `0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e` (3,011 bytes). No network access is needed during notice generation. Reverify the source before adding a fallback for a different version.
