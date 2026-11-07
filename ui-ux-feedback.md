Overall recommendation
Your application needs a shared design system, a clearer hierarchy, and more precise interaction states. The strongest direction is a calm reading and audio-production workspace: the book remains central, processing controls have a predictable home, and both themes use the same component rules.

I reviewed the four supplied screens: Library, Reader, Settings, and Models. The most serious visible problems are unreadable light-theme text, competing controls, repeated status information, and unclear action scope.

I created a light/dark Library redesign concept and a complete implementation brief for your AI agent:
[PDF Audiobook Studio UI Audit and Redesign Brief](https://chatgpt.com/space/page_ff2f32022b508191aef64ecea55f719c)
The brief includes exact colors, dimensions, component behavior, page specifications, validation requirements, and instructions for the implementation agent. The recommendations below explain the main decisions in detail.

Scope: these are findings from the supplied screenshots. Dark-mode behavior, mobile layouts, keyboard interaction, and the unseen Voices and Usage pages still need verification in the actual application. All dimensions below are proposed CSS dimensions.

1. Fix these problems first
   Priority What is visible now What should change
   Critical The product name, some selected navigation labels, and “Open reader” actions almost disappear against light backgrounds. Repair foreground/background combinations across the entire theme system.
   Critical Settings says “All changes are saved” while displaying “Cancel” and “Save Settings.” Define one understandable saving model with truthful states.
   High The Reader toolbar contains navigation, view selection, typography, regeneration, downloads, diagnostics, and settings together. Separate project navigation, document tools, and processing controls.
   High Reader side panels occupy approximately half the screenshot. Make the reading area dominant and Processing optional.
   High Black document gutters remain inside the light interface. Theme the reader canvas separately from the document surface.
   High “Ready,” “Running,” “Idle,” “Active,” and “Recommended” are used without consistent meaning. Define states around actual user outcomes and system behavior.
   Medium Large shadows, colorful icon tiles, gradients, and many badges compete for attention. Use neutral surfaces, restrained elevation, and one accent color.
   Medium Raw filenames, cache paths, and implementation explanations occupy primary space. Show clean display names and move technical detail into expandable sections.

The light-theme failures suggest inherited dark-theme foreground styles, such as hard-coded white text. Your agent should confirm the cause in code before applying a fix.

One positive finding: the Library totals are internally consistent. The three books contain 697 pages, their ready counts total 412, and their remaining counts total 285. The problem is the meaning and presentation of those numbers. 2. Establish one visual system for the whole application
Recommended visual direction
I recommend:

- Neutral off-white surfaces in light mode.
- Layered charcoal surfaces in dark mode.
- A restrained indigo accent.
- Strong, readable text.
- Thin dividers and minimal card shadows.
- Consistent typography, spacing, and corners.
- Colorful states only when they communicate something meaningful.
  The current cyan, purple, mint, orange, glow, and shadow treatments make too many elements appear important simultaneously.

A premium appearance should come from clear hierarchy, alignment, typography, and reliable behavior.
Exact color palette
Use semantic tokens so components refer to roles such as text-primary and surface, rather than choosing their own colors.
Role Light theme Dark theme
Application background #F6F7F9 #11151C
Cards and panels #FFFFFF #191F29
Menus and raised surfaces #FFFFFF #222B38
Subtle grouped surface #EEF1F6 #242E3D
Primary text #172033 #EEF2F7
Secondary text #526078 #B4BECD
Muted metadata #667085 #9AA8BA
Decorative dividers #DCE2EA #323D4D
Input/control boundaries #7B879A #748398
Primary action fill #4F46E5 #A69CFF
Text on primary action #FFFFFF #17122C
Primary action hover #4338CA #B8B0FF
Selected background #EEEBFF #2B2546
Selected text/link #4338CA #B7AEFF
Narration reading surface #FFFDF8 #1B2028
Narration text #292723 #E0E5EC

The button foreground must change between themes. The light-theme indigo button supports white text; the dark-theme lavender button should use dark text.

I calculated the specified opaque color pairs:

- Light primary text on white: approximately 16.27:1.
- Light secondary text on white: approximately 6.36:1.
- White text on the light primary button: approximately 6.29:1.
- Dark primary text on its panel: approximately 14.72:1.
- Dark text on the dark-theme primary button: approximately 7.61:1.
  These are checks of those pairs, not an accessibility certification of the application. Normal text generally needs at least 4.5:1 contrast; qualifying large text needs at least 3:1. Actual rendered colors, opacity, and interaction states must be checked. W3C
  Semantic colors
  Meaning Light text / background Dark text / background
  Success #166534 / #DCFCE7 #86EFAC / #163526
  Warning #92400E / #FEF3C7 #FCD34D / #3A2C14
  Error #B42318 / #FEE4E2 #FDA29B / #402425
  Information #1D4ED8 / #DBEAFE #93C5FD / #1C304A

“Selected,” “successful,” and “available” should not automatically share the same green badge.
Theme behavior
Provide Light, Dark, and System preferences. Theme switching should preserve the current page, playback position, editing draft, and processing state.

Apply theme tokens to every surface, including menus, dialogs, tooltips, inputs, placeholders, progress tracks, and the player. Keep the scanned PDF faithful to its source; document-specific dark rendering should be an explicit reading preference. 3. Typography, spacing, and component sizing
Typography
Use one consistent UI family with appropriate script fallbacks. Inter is a reasonable option, but retaining your existing font is fine if it renders well.
Element Recommended size / line height Weight
Page heading 28 / 36 px 600
Section heading 18 / 26 px 600
Book/model title 16 / 24 px 600
General interface text 14–15 / 20–24 px 400–500
Buttons and labels 14 / 20 px 500
Supporting metadata 12–13 / 18–20 px 400–500
English narration Start at 20 px / 1.7 400
Bengali narration Start at 22 px / 1.8 400
Arabic narration Start at 24 px / 1.9 400

Reading typography should be adjustable and separate from compact interface typography.

For your multilingual content, I would start with:

- Bengali UI: Noto Sans Bengali.
- Bengali narration: Noto Serif Bengali.
- Arabic UI: Noto Sans Arabic.
- Arabic narration: Noto Naskh Arabic.
  Test these with your actual books. Check Bengali conjuncts, Arabic diacritics, mixed-script lines, and fallback behavior. Avoid letter-spacing adjustments on Bengali and Arabic.
  Spacing and shape
  Use a restrained spacing scale: 4, 8, 12, 16, 24, 32, 48, 64 px.

Recommended component rules:

- Card padding: 20–24 px.
- Gaps between related controls: 8–12 px.
- Gaps between field groups: 16–24 px.
- Section spacing: 32–48 px.
- Control corners: 8 px.
- Card corners: 12 px.
- Dialog corners: 16 px.
- Desktop controls: approximately 40 px high.
- Touch controls: approximately 44–48 px high.
- Icons: 18–20 px, inside a larger interactive area.
  Remove the heavy shadows under every card. A fine border and subtle surface difference should establish most of the structure.

4. Library page redesign
   What the page should prioritize
   The Library should help someone:
1. Open a book.
1. Continue reading or listening.
1. Import a PDF.
1. Understand processing progress.
   The current four large statistic cards receive more emphasis than the books themselves.
   Recommended layout
   Use a centered 1280 px maximum content width, with:

- 32 px desktop side padding.
- 24 px tablet padding.
- 16 px mobile padding.
  Arrange the page vertically as follows:

1. Heading row: “Library” on the left; “Import PDF” on the right.
2. Compact summary: 3 books · 697 pages · 412 pages with audio.
3. Search and sort toolbar.
4. Book grid.
   Remove the four oversized summary cards from the default view. Their information can remain in the compact summary.

Use three columns where the container supports them, two on intermediate widths, and one on mobile. A starting breakpoint plan is three columns around 1120 px viewport width and two around 720 px, refined against actual content.

The empty space below three books is acceptable. It does not need additional dashboards or promotional content.
Book card structure
Each card should have:

- A 64 × 88 px source thumbnail near the upper-left.
- A 16 px semibold title beside it.
- Plain page-count metadata.
- An overflow menu at the upper-right.
- One meaningful work state.
- One audio-readiness measure and thin progress bar.
- Updated time at the lower-left.
- Open book at the lower-right.
  For example:
  Tafsir Ibn Kasir — Part 18
  298 pages
  Generating audio
  211 of 298 pages with audio

The current card repeats the same progress through “211 ready,” “71%,” and “87 pages left.” Keep one clear fraction and the bar.

Production progress and listening progress must remain separate. If a saved listening position exists, show “Last listened: page 162” independently. Audio files being generated does not mean the user has listened to those pages.
Titles and actions
Support a clean display title while retaining the original filename in details. Replacing underscores in the display name should not rename the underlying file or rewrite Bengali titles.

Move Delete into the overflow menu. The visible card action should be opening the book. Explain deletion consequences when the user chooses that action.

Use a real title link and an explicit opening action. Avoid a whole-card button containing other interactive controls.
Required Library states
Design the empty library, import progress, loading, no search results, partially processed book, and failed processing states. Keep unaffected books usable when one book has a problem. 5. Reader workspace redesign
This screen needs the most structural work.
A. Give each part a clear place
Region Recommended specification
Project header 56 px high
Document toolbar 44 px high
Page navigator 224 px default width
Reading area Flexible, with a comfortable 640–760 px text measure
Processing panel 320 px, opened when needed
Audio player 80–88 px, in a dedicated bottom layout row

The project header should show Library / Book title on the left, with Processing and the project menu on the right.

The second row should contain document views and tools relevant to the selected view.

Keep the Processing panel collapsed by default for ordinary reading. A user who is actively managing generation can open it and retain that preference.
B. Simplify the document toolbar
Use these content views:
Current label Recommended label
Refined Narration Narration
Main PDF Original PDF
Raw OCR Extracted text

Then change the tools according to the view:

- Narration: text appearance, edit narration, find.
- Original PDF: zoom, fit width/page, rotation if supported.
- Extracted text: appearance and editing/search tools that actually apply.
  Move infrequent project operations into a clear menu.

Make action scope explicit:

- Regenerate this page
- Regenerate selected pages
- Regenerate book audio
- Export book
- Download page audio
  “Replace” needs an object. Depending on the existing behavior, it should become Replace PDF, Replace page, or Find and replace text.

Your current toolbar “Download” and player “MP3” may have different functions, but the labels do not explain that difference.
C. Make the page navigator compact
Replace the large separate page cards with rows approximately 76–88 px high:

- Thumbnail around 40 × 56 px.
- Page number.
- One state such as Audio ready or Needs attention.
- A subtle selected background and 2–3 px edge marker.
  Remove the repeated three colored dots from every page. They require interpretation and add little value when every visible page shares the same state.

If “Jump to page #” is a numeric navigation field, label it Go to page and navigate on Enter. Full-text search should be a separate function.

The plus and square icons also need names based on what they actually do.
D. Improve the reading surface
Remove the black gutters from light mode. Use the dedicated reader canvas and paper colors.

The Original PDF view should preserve page geometry. Narration should reflow naturally within a comfortable reading column.

The highlighted paragraph in your screenshot may represent the currently playing passage. If so, give it a subtle, purposeful treatment. If it has no functional meaning, remove the background box.

For Arabic passages, use the correct direction without flipping the whole English interface. Isolate mixed-direction titles, numbers, and Latin text using appropriate markup. W3C recommends direction markup around opposite-direction phrases and dir="auto" or bdi for appropriate unknown-direction content. w3.org

A visual refactor should preserve your book text, punctuation, honorifics, citations, and script marks.
E. Redesign the Processing panel
Rename Pipeline Inspector to Processing in the normal interface.

Recommended order:

1. Overall job state and audio-ready count.
2. Extract text.
3. Prepare narration.
4. Generate audio.
5. One relevant primary control.
6. Failures and recovery actions.
7. Collapsed Project voices.
8. Collapsed Diagnostics.
   Each stage should distinguish:

- How much is complete.
- The total eligible work.
- What is happening now.
- Whether intervention is needed.
  The current legend shows 31 Text + 55 Script + 212 Audio = 298. These may be mutually exclusive readiness groups. Your agent should establish their meaning before changing the visualization.

If they are separate readiness groups, label them clearly. If they represent stage completion, use separate progress rows. Overlapping stage totals should not be stacked as parts of one whole.
F. Show the right processing action
Actual state Appropriate main action
Ready to begin Start processing
Running Pause processing, if supported
Paused Resume processing
Retryable failure Retry failed pages
Finished Show completion and relevant export/read action
Connection unavailable Reconnect or open connection settings

The current simultaneous Start all / Pause all / Step / Stop all arrangement makes the next action unclear.

Keep developer stepping in Diagnostics. Describe cancellation according to its actual effect on queued and completed work.

For voice changes, use clear copy:
New audio uses these voices. Existing recordings stay unchanged.

Then provide an explicitly scoped regeneration action where supported.
G. Make playback state unambiguous
Use three player regions:

- Left: playing book/page and elapsed/total time.
- Center: previous page, backward seek, Play/Pause, forward seek, next page.
- Right: speed, volume, and more options.
  Label seek intervals. A curved arrow alone could mean replay, seek, or regeneration.

Also distinguish viewing from playing:
Reader: Viewing page 164
Player: Playing page 162
Action: Follow audio

Do not unexpectedly move the user back to the playing page unless they enabled following.

Use real timing data for text highlighting. Define missing audio, generating audio, buffering, playback failure, paused, and ended states.
H. Responsive behavior
Width Reader behavior
1440 px and above Both panels may be pinned when wanted
1024–1439 px Page navigator may remain visible; Processing becomes a drawer
768–1023 px Both panels become drawers
Below 768 px One content column; panels open as sheets/dialogs

Protect the reading area based on available space and zoom.

The player must not cover the final paragraph. A dedicated layout row is preferable to an overlay. 6. Settings redesign
Use a dedicated Settings page
The current modal contains too much configuration for a temporary overlay.

Use:

- The shared application header.
- A 1120–1200 px maximum content width.
- A 208–224 px section navigation.
- A 32 px gutter.
- A 680–800 px form area.
  Keep quick reading appearance controls in a small reader popover.
  Organize settings by task
  Section Contents
  General Theme and interface preferences
  Reading & playback Reader typography, paper tone, playback defaults
  Processing Text extraction and narration preparation
  Speech Default voices and delivery settings
  Connections Provider, endpoint, authentication, model assignment
  Compute & storage Device, concurrency, runtime, cache, storage

Use Models as the canonical model-management destination. Avoid separate “Local AI Models” and “Model Hub” interfaces that appear to overlap.
Fix saving behavior
For connection and processing settings, I recommend explicit saving:
State UI
Clean “Saved”; Save disabled
Edited “Unsaved changes”; Cancel and Save enabled
Saving “Saving…”
Successful “Saved”
Failed Clear error; preserve entered values

Cancel should restore saved values. Ask about discarding only when actual unsaved changes exist.

Appearance preferences may save immediately, but that behavior should be clear and separate from staged configuration.
Make scope visible
Differentiate:

- Application defaults
- Project overrides
- Current generation job
- Existing generated audio
  Changing an application default should not imply that existing recordings have changed.
  Improve connection setup
  Arrange fields in a meaningful sequence:

Connection type → endpoint → authentication → model assignment → Test connection → result.

A saved configuration is not the same as a working connection.

Show API-key fields only when the chosen authentication mode needs them. Separate connectivity from usage accounting.

The existing “$0 billing” and “Free” wording also needs verification. A local proxy can forward requests elsewhere; display only the billing information the application actually knows. 7. Models page redesign
Main structure
Use the same management-page alignment as Library:

1. Models heading and Add model.
2. Compact operational summary.
3. Category, installation filter, and search.
4. Compact model list/table.
5. Expandable details.
   Replace the three large summary cards with a quieter strip showing installed count, model disk usage, free space, and runtime state.

“Storage & Local OCR” should be separated because storage and text-extraction availability answer different questions.
Compact model rows
A row around 88–112 px high can show:

- Model name.
- One useful description.
- Task.
- Relevant languages.
- Size.
- State.
- Specific next action.
  Move repository, revision, Python version, cache path, device, memory details, and licensing information into an expandable area.

These details are useful for your application; they simply do not all need permanent primary space.
Separate model states
State Meaning
Installed Files are present
Default Selected for a task or project
Loaded Resident in the runtime
Processing Currently executing work
Available Usable now
Error A specific requirement or operation failed

The screenshot repeats Ready & Active, Active Engine, Recommended, and Active. Replace this with precise state information.

Actions should be verbs: Install, Retry, Set as default, Use for narration, View details.

A status should not look like a disabled action button.

The Installed (8) filter appears selected while uninstalled models remain visible. This needs inspection: either the filtering is wrong or the selected styling is misleading.

Treat language counts, memory values, reference-voice requirements, and licensing claims as metadata that must be verified. The redesign should not turn uncertain values into guarantees. 8. Voices and Usage pages
These screens were not supplied, so these are proposed specifications.
Voices
Use a heading, Add voice, search, and relevant filters.

Each voice should show its name, language, compatible engine, sample duration, preview control, and menu.

Separate application-default voices from project selections. Allow only one preview to play at once.

A creation flow can be:

Upload/record → review transcript when required → preview → name and save.

Retain the reference if preview generation fails.
Usage
Start with date range and project filters. Every metric needs a unit, time range, and definition.

A details table can show time, project, stage, model/provider, usage, duration, outcome, and cost basis.

Keep these separate:

- Recorded provider charges.
- Estimated API cost.
- Local processing activity.
  Unknown cost should say Unavailable. It should not silently become $0.

9. Remove the generic generated-dashboard feel
   The main contributors are repeated “special” treatments:

- Sparkles beside routine functions.
- Colored squares around almost every icon.
- Several badges describing the same model.
- Gradient progress bars.
- Heavy shadows on every card.
- Explanations of internal machinery in primary task areas.
- Different names for the same destination.
  Use stable language throughout:
  Current wording Recommended wording
  New Project Import PDF, when that is the action
  Open reader Open book
  Main PDF Original PDF
  Raw OCR Extracted text
  Refined Narration Narration
  Pipeline Inspector Processing
  AI Gateway Connections
  Local AI Model Hub Models
  Voice Studio / Narrator Voices Voices, or Project voices
  Ready Specify what is ready
  Active Specify installed/default/loaded/processing
  Regenerate Specify object and scope

Keep technical terminology where it helps someone choose a model or diagnose a problem. 10. Build consistency into shared components
Your agent should consolidate components such as:

AppHeader, PageHeader, Button, IconButton, Field, Select, Tabs, StatusLabel, Progress, Card, Menu, Dialog, Drawer, EmptyState, BookCard, ModelRow, PageRow, and AudioPlayer.

Each relevant component needs defined:

Default, hover, pressed, focus, selected, disabled, loading, and error states—in both themes.

Do not use one generic opacity reduction for everything. An inactive tab is available; a disabled button is unavailable; a loading button is working. Those states need different treatment.

For accessibility:

- Meaningful visual cues identifying controls or states need sufficient contrast—generally 3:1 against adjacent colors. Subtle decorative card dividers are a different case. W3C
- Use 44–48 px touch targets as the product design goal. WCAG 2.2 AA’s minimum is 24 × 24 CSS px with specified exceptions. W3C
- Keep keyboard focus visible above sticky headers and players. The AA criterion requires that author-created content not entirely obscure the focused component. W3C
- Reflow ordinary interface content and narration at 320 CSS px equivalent width; a genuinely two-dimensional PDF canvas may need its own panning behavior. W3C
- Dialogs should manage focus, prevent interaction with modal background content, and return focus appropriately when closed. W3C
  Progress updates should not continuously interrupt screen-reader users. Announce meaningful transitions and errors.

11. Implementation order for your AI agent
    Phase 1 — Shared foundations
    Inspect the existing styles, routes, components, and state model. Implement semantic tokens, typography, spacing, and component states. Fix unreadable text first.
    Phase 2 — Library and Reader
    Simplify the Library hierarchy. Rebuild Reader composition around content, optional panels, scoped actions, and stable playback controls.
    Phase 3 — Settings and Models
    Resolve save behavior and configuration scope. Consolidate duplicate destinations. Separate model installation, default selection, and runtime state.
    Phase 4 — Validation
    Check both themes at narrow and wide sizes, with long titles and actual English, Bengali, and Arabic content.

Verify import/open, page navigation, playback, seeking, editing, saving, filtering, regeneration, and failure recovery. Theme changes should preserve ongoing work.

The completion report should contain:

- Changed pages and shared components.
- Before/after views of the four supplied screens.
- Both themes and representative mobile views.
- Tests actually performed and their outcomes.
- Any proposed behavior blocked by missing backend support.
  Give your agent the full brief, the four original screenshots, and the generated concept together. The written specifications should govern colors, dimensions, state meaning, and behavior; the concept provides the visual direction.
