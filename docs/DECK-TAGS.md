# Deck-building tags — reference for filters & themes

A catalogue of Magic mechanics, strategies, and format constraints you could turn into **deck tags** (filters, EDHREC-style themes, auto-suggest rules, or “build around X” modes).

Each entry notes whether the game gives you a **keyword** to hang a filter on, or whether you only get **oracle text / structure** — the gap you noticed (`discard` vs “draw two”).

**Legend**

| Mark | Meaning |
|------|---------|
| **KW** | Official keyword ability on the type line or rules text (`Flying`, `Landfall`) |
| **Oracle** | No keyword; detect via oracle text patterns (`draw a card`, `destroy target`) |
| **Structural** | Deck shape / role, not a card ability (`ramp`, `38 lands`) |
| **Format** | Rules of a format, not a card (`singleton`, `commander damage`) |
| **Archetype** | Player strategy spanning many cards (`tokens`, `control`) |

**Scryfall column** — rough search ideas only. Real filters need negation, “counts as”, and DFC/adventure faces; treat as starting points.

---

## 1. Card advantage & hand

| Tag | Type | What it is | Scryfall sketch | Combines with |
|-----|------|------------|-----------------|---------------|
| **Draw** | Oracle | Any card draw (`draw a card`, `draw two`, `draw X`) | `o:"draw"` (noisy) | Spells-matter, wheel, control |
| **Draw on cast/trigger** | Oracle | “Whenever you cast… draw” | `o:"whenever you cast" o:draw` | Spellslinger, storm |
| **Wheel** | Oracle | Mass discard + mass draw (`Wheel of Fortune` pattern) | `o:"each player discards" o:"draw"` | Discard, reanimator |
| **Loot / rummage** | Oracle | Draw then discard, or discard then draw | `o:"draw" o:"discard"` | Madness, reanimator, dredge |
| **Surveil** | KW | Look at top, put rest in graveyard | `keyword:surveil` | Graveyard, flashback |
| **Explore** | KW | Reveal top; land to hand or +1/+1 | `keyword:explore` | +1/+1 counters, landfall |
| **Impulse draw** | Oracle | Exile top, cast until EOT (`Lightning Axe` style “exile… cast”) | `o:"exile" o:"cast" o:"turn"` | Spells, impulse synergies |
| **Advantage engines** | Oracle | Repeatable draw ( repeatable triggers, “once each turn” ) | Hard — pattern match | Value, control |
| **Top manipulation** | Oracle | Look/scry/peek at library top | `o:"look at the top"` / `o:scry` | Combo, landfall |
| **Scry** | Oracle/KW | Scry N (not always keyword on older cards) | `o:scry` | Any refined strategy |
| **Mill (opponent)** | Oracle | Put cards from library into graveyard | `o:"mill"` / `o:"put" o:"graveyard" o:"library"` | Graveyard hate, combo |
| **Self-mill** | Oracle | Mill yourself for value | `o:"put" o:"cards" o:"your" o:"graveyard"` | Reanimator, dredge, delirium |
| **Discard (outgoing)** | Oracle/KW | Make opponents discard; **`Discard` as mechanic** | `o:"discards"` / `o:"discard a card"` | Reanimator (them), rack effects |
| **Discard (self)** | Oracle | Self-discard for cost or synergy | `o:"discard" o:"you"` | Madness, reanimator, dredge |
| **Madness** | KW | Cast from exile when discarded | `keyword:madness` | Discard, self-discard |
| **Empty hand** | Structural | Hellbent / “no cards in hand” payoffs | `o:"hellbent"` / `o:"no cards in hand"` | Rakdos discard, specters |
| **Hand size** | Oracle | Maximum hand size changes | `o:"maximum hand size"` | Niche stax |

**Note:** “Draw two” has no keyword — it’s always **`Draw` + oracle**. Same bucket as “cantrip” unless you split by CMC/card type.

---

## 2. Evergreen & common keyword combat

| Tag | Type | KW | Scryfall | Archetype fit |
|-----|------|----|----------|---------------|
| **Flying** | KW | yes | `keyword:flying` | Evasion, aggro, control |
| **First strike** | KW | yes | `keyword:"first strike"` | Aggro, vampires |
| **Double strike** | KW | yes | `keyword:"double strike"` | Voltron, aggro |
| **Trample** | KW | yes | `keyword:trample` | Go tall, stompy |
| **Deathtouch** | KW | yes | `keyword:deathtouch` | Midrange, blockers |
| **Lifelink** | KW | yes | `keyword:lifelink` | Lifegain, aggro |
| **Vigilance** | KW | yes | `keyword:vigilance` | Go wide, stax |
| **Reach** | KW | yes | `keyword:reach` | Anti-flying |
| **Haste** | KW | yes | `keyword:haste` | Aggro, najeela |
| **Menace** | KW | yes | `keyword:menace` | Aggro |
| **Hexproof** | KW | yes | `keyword:hexproof` | Voltron, protection |
| **Ward** | KW | yes | `keyword:ward` | Value creatures |
| **Indestructible** | KW | yes | `keyword:indestructible` | Stax, protection |
| **Flash** | KW | yes | `keyword:flash` | Control, instants |
| **Defender** | KW | yes | `keyword:defender` | Walls, animate wall |
| **Fight / bite** | KW | yes | `keyword:fight` / `keyword:bite` | Stompy, +1/+1 |
| **Prowess** | KW | yes | `keyword:prowess` | Spellslinger |
| **Afflict** | KW | yes | `keyword:afflict` | Aggro |

---

## 3. Tokens & “go wide”

| Tag | Type | Notes | Scryfall sketch |
|-----|------|-------|-----------------|
| **Tokens (any)** | Oracle | “Create a … token” | `o:"create" o:"token"` |
| **Token type: Soldier / Clue / Food / …** | Oracle | Named token creature types | `o:"create" o:"Soldier" o:"token"` |
| **Go wide** | Archetype | Many small creatures | Structural + token tag |
| **Anthem** | Oracle | “Creatures you control get +” | `o:"creatures you control get"` |
| **Populate** | KW | Copy token you control | `keyword:populate` |
| **Convoke** | KW | Tap creatures to help cast | `keyword:convoke` |
| **Improvise** | KW | Tap artifacts to help cast | `keyword:improvise` |
| **Affinity** | KW | Cost reduction per artifact | `keyword:affinity` |
| **Offspring / encore / myriad** | KW | Extra copies or tokens | respective `keyword:` |
| **Ninjutsu** | KW | Exile unblockable, swap | `keyword:ninjutsu` |
| **Sneak attack pattern** | Oracle | Cheat creatures into play | `o:"put" o:"battlefield" o:"creature"` |

---

## 4. +1/+1 counters & “go tall”

| Tag | Type | Notes | Scryfall |
|-----|------|-------|----------|
| **+1/+1 counters** | Oracle | “Put a +1/+1 counter” | `o:"+1/+1 counter"` |
| **Proliferate** | KW | Add counter of each kind | `keyword:proliferate` |
| **Adapt** | KW | Optional +1/+1 if none | `keyword:adapt` |
| **Modular** | KW | +1/+1 on death to artifact | `keyword:modular` |
| **Evolve** | KW | +1/+1 when bigger creature | `keyword:evolve` |
| **Support** | KW | Distribute +1/+1 | `keyword:support` |
| **Bolster** | KW | +1/+1 on smallest | `keyword:bolster` |
| **Unleash** | KW | +1/+1 vs can’t block | `keyword:unleash` |
| **Renown** | KW | Become renowned + counters | `keyword:renown` |
| **Go tall** | Archetype | Few big creatures | Structural |
| **-1/-1 counters** | Oracle | Persist/undying opposite | `o:"-1/-1 counter"` |

---

## 5. Graveyard

| Tag | Type | KW? | Scryfall |
|-----|------|-----|----------|
| **Reanimate** | Oracle | no | `o:"return" o:"creature" o:"graveyard" o:"battlefield"` |
| **Recursion (general)** | Oracle | no | `o:"return" o:"from your graveyard"` |
| **Flashback** | KW | yes | `keyword:flashback` |
| **Unearth** | KW | yes | `keyword:unearth` |
| **Escape** | KW | yes | `keyword:escape` |
| **Disturb** | KW | yes | `keyword:disturb` |
| **Dredge** | KW | yes | `keyword:dredge` |
| **Delve** | KW | yes | `keyword:delve` |
| **Undergrowth** | Oracle/KW | partial | `o:undergrowth` |
| **Threshold / delirium** | Oracle | no | `o:delirium` / `o:threshold` |
| **Graveyard as resource** | Archetype | — | Combine dredge, delve, escape |
| **Grave hate** | Oracle | no | `o:"exile target" o:"graveyard"` |

---

## 6. Removal & interaction

| Tag | Type | Oracle pattern | Scryfall sketch |
|-----|------|----------------|-----------------|
| **Destroy creature** | Oracle | “Destroy target creature” | `o:"destroy target creature"` |
| **Destroy permanent** | Oracle | broader | `o:"destroy target"` |
| **Exile** | Oracle | “Exile target …” | `o:"exile target"` |
| **Bounce** | Oracle | Return to hand | `o:"return" o:"to" o:"hand"` |
| **-X/-X** | Oracle | Shrink / kill small | `o:"-X/-X"` / `o:"gets -"` |
| **Damage-based removal** | Oracle | Burn on creatures | `o:"damage" o:"creature"` |
| **Board wipe** | Oracle | “Destroy all creatures” etc. | `o:"destroy all creatures"` |
| **Spot vs mass** | Structural | Role split | CMC / text length heuristics |
| **Counterspell** | Oracle | Counter target spell | `o:"counter target"` |
| **Tax / stax** | Oracle | “Pay more”, “can’t cast” | `o:"unless its controller pays"` |
| **Tap down** | Oracle | Lock creatures | `o:"tap target creature"` |
| **Go blank** | Oracle | “Becomes a copy” / “lose all abilities” | niche |
| **Hand attack** | Oracle | Discard, specter triggers | discard tags |
| **Graveyard hate** | Oracle | Exile from gy | see above |
| **Artifact / enchantment removal** | Oracle | “Destroy target artifact” | type-specific `o:` |
| **Land destruction** | Oracle | LD (often socially banned in EDH) | `o:"destroy target land"` |

---

## 7. Mana & ramp

| Tag | Type | Notes | Scryfall |
|-----|------|-------|----------|
| **Ramp (add mana)** | Oracle | “Add {G}”, mana dorks, rocks | `o:"add {"` / `t:artifact o:"add"` |
| **Land ramp** | Oracle | Search library for land | `o:"search" o:"land" o:"library"` |
| **Extra land drop** | Oracle | “Play an additional land” | `o:"additional land"` |
| **Landfall** | KW | Land enters trigger | `keyword:landfall` |
| **Ritual** | Oracle | Temporary burst (Dark Ritual) | `o:"add" o:"until"` |
| **Cost reduction** | Oracle | “Cost {1} less” | `o:"cost" o:"less"` |
| **Cheating mana** | Oracle | Cascade, “without paying” | `keyword:cascade` / `o:"without paying"` |
| **Mana sink** | Oracle | Repeatable mana spend | `o:"spend"` / `o:"pay {X}"` |
| **Treasure** | Oracle | Treasure token | `o:"Treasure token"` |
| **Clue / Food / Blood** | Oracle | Other artifact tokens | `o:"Clue token"` etc. |
| **Rocks vs dorks** | Structural | Artifact vs creature ramp | `t:artifact` vs `t:creature` |

---

## 8. Life total

| Tag | Type | Scryfall |
|-----|------|----------|
| **Lifegain** | Oracle | `o:"gain" o:"life"` |
| **Life drain** | Oracle | `o:"loses" o:"life" o:"gain"` |
| **Pay life** | Oracle | `o:"pay" o:"life"` |
| **Life as resource** | Archetype | Necropotence pattern | combine pay life + draw |
| **Low life payoffs** | Oracle | `o:"life total is 10 or less"` etc. |

---

## 9. Spells & stack

| Tag | Type | KW? | Notes |
|-----|------|-----|-------|
| **Instants & sorceries matter** | Oracle | no | “Instant or sorcery” triggers |
| **Storm** | KW | yes | Copy on cast chain |
| **Cascade** | KW | yes | Free cast from top |
| **Magecraft** | KW | yes | On instant/sorcery cast |
| **Prowess** | KW | yes | On noncreature spell |
| **Copy spell** | Oracle | no | Twincast effects |
| **Spellslinger** | Archetype | — | Combines storm, prowess, magecraft |
| **Cantrip** | Structural | — | Cheap draw spell (CMC ≤ 2 + draw) |
| **Burn** | Oracle | no | “Deal damage to any target” |
| **X spells** | Oracle | no | `{X}` in mana cost |

---

## 10. Artifacts, enchantments, equipment

| Tag | Type | Scryfall / notes |
|-----|------|------------------|
| **Artifacts matter** | Oracle | `t:artifact` + `o:"artifact"` triggers |
| **Enchantments matter** | Oracle | `t:enchantment` + constellation |
| **Constellation** | KW | `keyword:constellation` |
| **Voltron** | Archetype | Commander + equipment/aura stack |
| **Equipment** | Structural | `t:equipment` |
| **Auras** | Structural | `t:aura` |
| **Treasure / Clue synergy** | Oracle | token tags |
| **Sacrifice outlets** | Oracle | `o:"sacrifice" o:":"` — artifacts often |

---

## 11. Planeswalkers & battles

| Tag | Type | Notes |
|-----|------|-------|
| **Superfriends** | Archetype | Many planeswalkers |
| **Proliferate** | KW | Loyalty counters |
| **Battles (Sieges)** | Type | `t:battle` |
| **Protect walkers** | Oracle | Fog, token blockers |

---

## 12. Lands & land-based strategies

| Tag | Type | Scryfall |
|-----|------|----------|
| **Lands matter** | Archetype | landfall + land recursion |
| **Land animation** | Oracle | `o:"becomes a" o:"creature" o:"land"` |
| **Cycling lands / triomes** | Oracle | `keyword:cycling` on lands |
| **Bounce lands** | Structural | karoo-style |
| **Utility lands** | Structural | non-mana lands |
| **Land count (38/37/…)** | Structural | deck constraint, not card tag |

---

## 13. Tribal

Creature types as tags — **subtype on type line**, not keywords.

Examples with strong tribal support in EDH:

| Tag | Scryfall |
|-----|----------|
| **Elves** | `t:elf` |
| **Goblins** | `t:goblin` |
| **Zombies** | `t:zombie` |
| **Vampires** | `t:vampire` |
| **Dragons** | `t:dragon` |
| **Merfolk** | `t:merfolk` |
| **Wizards** | `t:wizard` |
| **Soldiers** | `t:soldier` |
| **Angels** | `t:angel` |
| **Demons** | `t:demon` |
| **Cats / Dogs / Birds** | `t:cat` etc. |
| **Slivers** | `t:sliver` |
| **Myr / Eldrazi / Phyrexian** | type-based |
| **Mutant / Ninja / Rogue** | cross-archetype |

**Note:** “Tribal” is often **type line + lord** (“Other Elves get +1/+1”).

---

## 14. Color & identity (format rules)

| Tag | Type | Use |
|-----|------|-----|
| **Color identity W/U/B/R/G** | Format | Commander legality — already in Lugin |
| **Monocolored / two-color / five-color** | Structural | deck constraint |
| **Colorless** | Structural | `id:c` |
| **Hybrid mana** | Oracle | `{W/U}` symbols |
| **Phyrexian mana** | Oracle | `{W/P}` |
| **Devotion** | Oracle | `o: devotion` (Theros) |

---

## 15. Commander & multiplayer rules (format, not cards)

These shape **how** decks are built, not **what** cards do:

| Rule / concept | Tag idea | Implication for filters |
|----------------|----------|-------------------------|
| **Singleton** | Format | 1 copy except basics |
| **100 cards** (99+CMD) | Format | deck size target |
| **Commander in command zone** | Format | must include 1 legal CMD |
| **Commander tax** | Format | cost escalation — suggests recast / protection |
| **Commander damage (21)** | Format | voltron, infect-adjacent |
| **Color identity** | Format | subset of WUBRG |
| **Partner / Background / Doctor** | KW + rules | pairing constraints (Lugin has `CommanderInfo`) |
| **Banned list** | Format | format-specific exclusions |
| **Bracket / power level** | Meta | not in rules text |
| **Multiplayer politics** | Archetype | “threat”, “table hate”, board wipes |

---

## 16. Classic archetypes (cross-cutting — few keywords)

These are **deck strategies**; cards are tagged by **roles** inside them:

| Archetype | Core idea | Typical tag bundle |
|-----------|-----------|-------------------|
| **Aggro** | Fast damage, low curve | haste, 1–3 CMC, burn |
| **Midrange** | Efficient threats + interaction | 2-for-1s, removal |
| **Control** | Answer everything, win late | counter, wipe, draw |
| **Combo** | Assemble win condition | tutor, recursion, specific pairs |
| **Stax** | Restrict resources | tax, tap, “can’t”, land wipe |
| **Voltron** | One big commander | equipment, aura, protection |
| **Tokens** | Many creatures | create token, anthem |
| **Reanimator** | Cheat from gy | reanimate, self-mill |
| **Spellslinger** | Chain instants/sorceries | storm, prowess, copy |
| **Ramp → haymaker** | Big mana finishers | ramp + fatties |
| **Group slug** | Hurt everyone equally | drain, mass damage |
| **Aristocrats** | Sacrifice for value | “when ~ dies”, sacrifice outlets |
| **Blink / ETB** | Re-enter for triggers | “exile… return”, ETB |
| **Landfall value** | Land drops | landfall, extra land |
| **Turbo / fast mana** | Win turn 3–5 | ritual, tutors, combo |

---

## 17. Trigger shapes (oracle patterns — no keywords)

Useful for **synergy detection** when building “cards that care about X”:

| Pattern | Example | Filter idea |
|---------|---------|-------------|
| **ETB** | “When ~ enters” | `o:"when" o:"enters the battlefield"` |
| **LTB** | “When ~ dies” | `o:"when" o:"dies"` |
| **Attack trigger** | “Whenever ~ attacks” | `o:"whenever" o:"attacks"` |
| **Cast trigger** | “Whenever you cast” | `o:"whenever you cast"` |
| **End step / upkeep** | phase triggers | phase words in oracle |
| **Sacrifice trigger** | “Whenever you sacrifice” | aristocrats |
| **Draw trigger** | “Whenever you draw” | obscure but exists |
| **Landfall trigger** | land enters | `keyword:landfall` or `o:"landfall"` |
| **Life gain trigger** | “Whenever you gain life” | lifegain arch |
| **Counter placed** | “Whenever a counter is put” | +1/+1 synergies |
| **Token created** | “Whenever you create” | token payoffs |

---

## 18. Set / mechanic families (deciduous & block mechanics)

Often **KW within a block** but still useful as tags for historical / Commander cards:

| Family | KW / pattern |
|--------|----------------|
| **Kicker** | `keyword:kicker` |
| **Flashback / jump-start** | graveyard cast |
| **Foretell / morph / disguise** | cast face-down / delayed |
| **Mutate / augment / merge** | creature stacking |
| **Party (cleric/rogue/wizard/warrior)** | `o:party` |
| **Venture / dungeon** | `o:dungeon` |
| **The Ring / Ring-bearer** | LotR |
| **Craft / conjure / duplicate** | digital / special |
| **Energy** | `o:energy` |
| **Experience** | `o:experience counter` |
| **Monarch / initiative** | multiplayer markers |
| **Day / night** | `o:day` / transform links |
| **Craft with components** | artifact tokens |

---

## 19. Roles (structural tags for deck composition)

Independent of mechanics — how **deck builders** think about slots:

| Role | Description |
|------|-------------|
| **Ramp** | Mana acceleration |
| **Card draw / selection** | Refuel |
| **Targeted removal** | Answer one threat |
| **Board wipe** | Answer many |
| **Counterspell** | Stack interaction |
| **Tutor** | `o:"search your library"` |
| **Protection** | Hexproof, indestructible, phase |
| **Recursion** | Get resources back |
| **Win condition** | Combo piece or finisher |
| **Synergy engine** | Payoff for theme |
| **Enabler** | Makes theme work |
| **Mana base** | Lands + fixing |
| **Mana sink** | Uses extra mana |
| **Curve filler** | 2–4 CMC glue |

A **deck tag filter** could mean: “suggest cards with role X that match theme Y”.

---

## 20. EDHREC-style theme names (external reference)

EDHREC already publishes **theme slugs** per commander (`themes[]` in their JSON). Examples seen in the wild:

- Tokens, Sacrifice, +1/+1 Counters, Artifacts, Enchantments  
- Wheels, Group Hug, Stax, Voltron  
- Tribal names (Elves, Dragons, …)  
- “Goodstuff”, “Budget”, “High Synergy”

Worth aligning any Lugin tag set with **EDHREC theme vocabulary** where overlap exists — users already think in those words.

---

## 21. Implementation notes for Lugin

### What Scryfall gives you today

- **`keyword:`** — KW abilities  
- **`o:"text"`** — oracle full text (fragile, quoting)  
- **`t:`** — type / subtype  
- **`mv` / `cmc`** — mana value  
- **`id:`** — color identity  
- **`is:`** — layout, foil, etc.

Already used in `src/lib/search.ts` (`buildScryfallQuery`, filters in `DeckPanel` AddCardBox).

### What needs card metadata (oracle + keywords)

For **“is this card part of theme X?”** on cards already in a deck:

1. Scryfall **`keywords[]` + `oracle_text`** on `CardMetadata` (`src/lib/mtg.ts`)  
2. Rule table: tag → matcher function (keyword set, regex on oracle, type check)  
3. Optional: **manual overrides** for famous non-keyword cards  

### Keyword vs non-keyword summary

| Easy (KW) | Hard (oracle / structural) |
|-----------|----------------------------|
| Flying, landfall, flashback | Draw, loot, reanimate |
| Storm, cascade, convoke | Ramp, removal roles |
| Menace, lifelink | Aristocrats, voltron |
| Partner (rules text parse) | “Draw two”, wheel, stax |

### Combined tags

Many real decks are **intersections**:

- `discard` + `reanimate`  
- `tokens` + `anthem` + `convoke`  
- `landfall` + `extra land drops`  
- `spellslinger` + `storm`  

A filter UI might offer **primary theme** + **optional secondary** rather than one tag only.

---

## 22. Suggested next step (when you pick tags)

1. **Star ~15 tags** you care about for Commander deck building.  
2. For each, mark **KW / oracle / structural** and one **Scryfall probe query**.  
3. Build a **`deckTags.ts`** map: `tagId → { label, match(card: CardMetadata): boolean }`.  
4. Use in deck editor: “show suggestions matching deck tags”, “highlight off-theme cards”, “suggested cuts if tag density is low”.  

This file is the menu; the code can stay small until you choose which items matter.

---

*Generated for Lugin deck-building exploration. Not exhaustive — Magic adds mechanics every set. Extend as needed.*
