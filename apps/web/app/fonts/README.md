# MiSans

Orbit uses MiSans by Xiaomi for Chinese, Latin text and numbers.

The following unmodified WOFF2 files were copied from the [official MiSans package](https://hyperos.mi.com/font-download/MiSans.zip) on 2026-10-22:

| File                  | Weight | SHA-256                                                          |
| --------------------- | ------ | ---------------------------------------------------------------- |
| MiSans-Regular.woff2  | 400    | d704c1a932c0bd7e8a071d276cd81c0ed0c9fecfa26ac234f4bed0559fe1cb2d |
| MiSans-Medium.woff2   | 500    | 44e28ca6c2f0ca79829f192831ef87b5eec7c464f5cfb7a83467f57bb6e58114 |
| MiSans-Semibold.woff2 | 600    | 78227c6ec59566785c65ac0b5312328bfa2f879918f3d7403725785615a9a8f6 |

The original license is saved at `apps/web/public/fonts/MiSans-license.pdf` and linked from the application's help dialog. Font source and usage terms are available on the [official website](https://hyperos.mi.com/font/zh/download/).

Keep these original files intact. They have not been subsetted or converted. The three faces total approximately 14.1 MiB; `next/font/local` serves fingerprinted local assets with `display: swap` and loads only faces requested by the page, without preloading unused weights.
