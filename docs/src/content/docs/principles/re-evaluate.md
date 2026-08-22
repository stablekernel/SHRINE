---
title: "Knowing When to Re-evaluate"
description: "What signals tell us it's time to revisit our choices?"
---

**You can't feel a 30% tax. That's what makes it dangerous.**

If our stack silently fell behind: a better model we didn't adopt, a skill that stopped pulling its weight, a pattern the field has since leapfrogged. What would that look like from the inside?

Here's the trouble: it would look like *nothing*. Every task would still complete. Every agent would still return answers. The work would be a bit slower, a bit more expensive, a bit more error-prone than it needed to be, and no single day would ever feel wrong.

The opposite failure is just as real. A team that re-litigates its model choice every time a benchmark tweet goes by never compounds on anything. Constant churn is its own tax: paid in migration cost, retraining, and the value of muscle memory you keep throwing away.

## The Real Question

It isn't "should we re-evaluate?" It's "what tells us *when*?"

### Observations from domains that already solved this:

- We don't ask "does the service feel slow?" We have SLOs, baselines, and alerts. The whole point of monitoring is that human perception is a terrible drift detector.
- Good alerting is defined as much by what it *ignores* as what it catches. An alert that fires weekly gets muted. The discipline is choosing thresholds that fire rarely and mean something.
- The teams that respond fastest to change aren't the ones watching hardest. They're the ones who decided in advance what would trigger a response.

## The Questions

1. **Do we have a baseline?** If someone asked "what's our current cost per shipped change, and our first-pass success rate on standard tasks?": could we answer with a number, or a shrug?

2. **What external events should automatically trigger a look?** A frontier model release is an obvious one. What else: a pricing change, a new orchestration pattern getting real adoption, a capability we currently scaffold around becoming native?

3. **What internal signals should?** Agents needing more retries. Humans re-doing agent output more often. Token spend per outcome creeping up. Are any of these visible today, or would they hide inside "that's just how it is"?

4. **What's our equivalent of an alert threshold:** the line that separates "interesting, noted" from "stop and re-evaluate now"?

## The Shape of a Good Answer

A small set of tripwires, checked cheaply, most of the time saying "you're fine."

That last part matters. A sensor that usually says "no action needed" isn't overhead: it's what *earns you the right* to ignore the noise the rest of the time. Confidence in the current setup and vigilance about it are the same instrument.

## The Trap

The trap isn't failing to re-evaluate. It's never having decided what would make us.

**Without explicit signals, we're left with the two default modes: drift until the gap is embarrassing, or churn on vibes. Both are expensive.**

The alternative costs almost nothing: decide what we'd measure, measure it now, and write down, in advance, what reading would make us act.
