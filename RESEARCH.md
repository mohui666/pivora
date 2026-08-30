# Open-source gap scan — 2026-08-30

The phrase “no open-source alternative” is easy to overstate. This scan uses a
stricter and more useful threshold: no mature, like-for-like open-source product
was found for the product's defining workflow. A generic tool in the same broad
category does not automatically close that gap.

## Candidates evaluated

| Commercial product/category | Defining workflow | Finding | Decision |
| --- | --- | --- | --- |
| Microsoft Power BI Desktop | Import local files, model fields, and author interactive reports on one computer | Open-source BI products exist, but the leading ones are primarily database-backed, server-oriented platforms. Apache Superset explicitly works above SQL data stores and has no data storage layer. | **Selected.** Build the missing local-file-first authoring slice. |
| Motion / Reclaim / SkedPal | Automatically place and reschedule tasks around calendar constraints | FluidCalendar, Dayotter, Atomic, and other active open-source projects now target this workflow directly. | Rejected: the premise is no longer true. |
| Typeface / RightFont | Visually browse, classify, compare, and activate large font libraries | ZFontManager now provides a cross-platform GPL implementation, while Fontist covers automated installation. | Rejected: an open-source alternative exists. |
| Principle / ProtoPie | Build high-fidelity, timeline-driven interactive UI prototypes | The commercial gap still looks meaningful, especially for a cross-platform motion-first editor, but the implementation is substantially larger and the search did not establish absence strongly enough. | Keep as a future research candidate, not a confirmed claim. |
| Hookmark | Create stable links and bidirectional relationships between local files, email, notes, and web pages | The workflow is unusually specific and the commercial product is paid, but reliable cross-app integration is OS- and application-specific. | Keep as a future systems project. |

## Why LocalLens BI

Power BI Desktop is free to download but proprietary, Windows-oriented, and its
sharing workflow belongs to Microsoft's hosted licensing model. Metabase and
Superset are excellent open-source BI systems, but their public product and
technical descriptions center on connecting databases, deploying a service,
and sharing analytics with a team.

That leaves a narrower underserved job: open a CSV on an ordinary computer,
understand its fields, build a useful visual, and keep every row local. LocalLens
BI implements that job as a small, auditable, browser-native application.

## Evidence reviewed

- Microsoft Power BI licensing overview:
  https://download.microsoft.com/download/2/9/b/29bf9987-37d6-4cd6-b4e1-fcdb556baa40/Licensing%20Power%20BI%20v21.40.pdf
- Apache Superset repository and product description:
  https://github.com/apache/superset
- Apache Superset dashboard tutorial and storage model:
  https://github.com/apache/superset/blob/master/docs/docs/using-superset/creating-your-first-dashboard.mdx
- Metabase repository and product description:
  https://github.com/metabase/metabase
- Motion pricing and product description:
  https://www.usemotion.com/pricing
- FluidCalendar open-source alternative announcement:
  https://blog.fluidcalendar.com/fluidcalendar-open-source-intelligent-task-scheduling/
- ZFontManager repository:
  https://github.com/TheHolyOneZ/ZFontManager
- Principle product page:
  https://www.principle.app/
- ProtoPie pricing:
  https://www.protopie.io/plans
- Hookmark pricing and feature matrix:
  https://hookproductivity.com/buy/
