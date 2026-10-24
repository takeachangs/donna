> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Tags

> Inline control tokens that shape emotion, style, prosody, and sound effects inside the input text.

Inline tags control delivery at the token level. Insert them anywhere in `input`, and the model adjusts the surrounding speech. For example:

```
<|emotion:enthusiasm|>Welcome to the show!
<|prosody:pause|>Let's get started!
```

Tags fall into five categories:

* **emotion**: `<|emotion:…|>`, such as elation, fear, anger.
* **style**: `<|style:…|>`, such as shouting, whispering.
* **sound effects**: `<|sfx:…|>`, such as cough, sneeze.
* **prosody**: `<|prosody:…|>`, including speed, pause, pitch, and expressiveness.
* **other**: `<|reset|>`, which resets delivery to neutral.

Recommended usage:

* Set delivery with delivery tokens. Emotion, style, speed, pitch, and expressiveness tags set how the text after them is delivered. Place them at the start of the input to set delivery for the whole turn. To change delivery partway through, add a new group of delivery tokens where the change begins. A new group replaces the previous one entirely: in `<|emotion:anger|><|prosody:speed_fast|>Text one. <|emotion:sadness|>Text two.`, "Text two." is sad at normal speed. Use `<|reset|>` to clear all delivery tokens and return to neutral delivery.

* Place positional tokens exactly where they take effect. `<|prosody:pause|>` and `<|prosody:long_pause|>` go where the break should fall, and each `<|sfx:…|>` goes right before the sound it triggers.

* Pair every sound effect with onomatopoeia. A `<|sfx:…|>` token works best when the matching written sound follows immediately, such as `<|sfx:laughter|>Haha`, `<|sfx:sigh|>Uh`, or `<|sfx:sneeze|>Achoo`. The written cue helps the model realize the sound effect.

## Emotion

| Tag | Effect | Sample input | Sample audio |
| - | - | - | - |
| `<\|emotion:elation\|>` | Elation / joy | `<\|emotion:elation\|>This is the best news ever, I am absolutely thrilled!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_elation.mp3" /> |
| `<\|emotion:amusement\|>` | Amusement / playful laughter | `<\|emotion:amusement\|>Oh that's hilarious, I can't stop giggling about it.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_amusement.mp3" /> |
| `<\|emotion:enthusiasm\|>` | Enthusiasm / excitement | `<\|emotion:enthusiasm\|>Let's go, I can't wait, this is going to be amazing!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_enthusiasm.mp3" /> |
| `<\|emotion:determination\|>` | Determination / firmness | `<\|emotion:determination\|>No matter what happens, I will not give up on this.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_determination.mp3" /> |
| `<\|emotion:pride\|>` | Pride / confidence | `<\|emotion:pride\|>Look at how far I've come. I never once doubted that I'd make it here.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_pride.mp3" /> |
| `<\|emotion:contentment\|>` | Calm satisfaction | `<\|emotion:contentment\|>Everything feels just right, I'm perfectly at peace.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_contentment.mp3" /> |
| `<\|emotion:affection\|>` | Warmth / affection | `<\|emotion:affection\|>I'm so grateful to have you in my life, truly.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_affection.mp3" /> |
| `<\|emotion:relief\|>` | Relief | `<\|emotion:relief\|>Oh thank goodness, it's finally over, what a relief.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_relief.mp3" /> |
| `<\|emotion:contemplation\|>` | Thoughtful / reflective | `<\|emotion:contemplation\|>Sometimes I just sit and wonder what it all really means.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_contemplation.mp3" /> |
| `<\|emotion:confusion\|>` | Confused | `<\|emotion:confusion\|>Wait, I don't understand, what is even going on here?` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_confusion.mp3" /> |
| `<\|emotion:surprise\|>` | Surprised | `<\|emotion:surprise\|>What? No way, I did not see that coming at all!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_surprise.mp3" /> |
| `<\|emotion:awe\|>` | Awe / wonder | `<\|emotion:awe\|>Wow, look at that, I have never seen anything so breathtaking.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_awe.mp3" /> |
| `<\|emotion:longing\|>` | Longing / yearning | `<\|emotion:longing\|>I miss you more than words can say, please come back to me.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_longing.mp3" /> |
| `<\|emotion:arousal\|>` | Heightened desire | `<\|emotion:arousal\|>Come closer, I can't stop thinking about you tonight.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_arousal.mp3" /> |
| `<\|emotion:anger\|>` | Anger | `<\|emotion:anger\|>How dare you do that to me, this is completely unacceptable!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_anger.mp3" /> |
| `<\|emotion:fear\|>` | Fear | `<\|emotion:fear\|>Did you hear that? Something is out there, I'm really scared.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_fear.mp3" /> |
| `<\|emotion:disgust\|>` | Disgust | `<\|emotion:disgust\|>Ugh, that is absolutely revolting, I can't even look at it.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_disgust.mp3" /> |
| `<\|emotion:bitterness\|>` | Bitterness | `<\|emotion:bitterness\|>After everything I did for them, this is how they repay me.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_bitterness.mp3" /> |
| `<\|emotion:sadness\|>` | Sadness | `<\|emotion:sadness\|>I really thought things would be different, it hurts so much.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_sadness.mp3" /> |
| `<\|emotion:shame\|>` | Shame | `<\|emotion:shame\|>I can't believe I did that, I'm so embarrassed and ashamed.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_shame.mp3" /> |
| `<\|emotion:helplessness\|>` | Helplessness | `<\|emotion:helplessness\|>There's nothing I can do anymore, I just feel so powerless.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/emotion_helplessness.mp3" /> |

## Style

| Tag | Effect | Sample input | Sample audio |
| - | - | - | - |
| `<\|style:singing\|>` | Singing | `<\|style:singing\|>Dancing in the rain, feeling so alive again.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/style_singing.mp3" /> |
| `<\|style:shouting\|>` | Shouting / projected voice | `<\|style:shouting\|>Hey! Over here! Everybody listen to me right now!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/style_shouting.mp3" /> |
| `<\|style:whispering\|>` | Whisper | `<\|style:whispering\|>Lean in, I have a little secret just for you, don't tell anyone.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/style_whispering.mp3" /> |

## Sound effects

Sound effects are vocalized — produced in the speaker's voice — not mixed-in audio assets.

| Tag | Effect | Sample input | Sample audio |
| - | - | - | - |
| `<\|sfx:cough\|>` | Cough | `<\|sfx:cough\|>Ahem, could I have everyone's attention, please?` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/sfx_cough.mp3" /> |
| `<\|sfx:laughter\|>` | Laughter | `<\|sfx:laughter\|>Haha, that's the funniest thing I've heard all day!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/sfx_laughter.mp3" /> |
| `<\|sfx:crying\|>` | Crying | `<\|emotion:sadness\|><\|sfx:crying\|>I... I’m sorry.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/sfx_crying.mp3" /> |
| `<\|sfx:screaming\|>` | Screaming | `<\|sfx:screaming\|>Ah, no, no, this can't be happening!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/sfx_screaming.mp3" /> |
| `<\|sfx:burping\|>` | Burping | `<\|sfx:burping\|>Burp—ugh, whoa, sorry, that one snuck up on me.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/sfx_burping.mp3" /> |
| `<\|sfx:humming\|>` | Humming | `<\|sfx:humming\|>Hmm, that's a tricky question, isn't it?` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/sfx_humming.mp3" /> |
| `<\|sfx:sigh\|>` | Sigh | `<\|sfx:sigh\|>Ahh, well, there's nothing left to do but wait.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/sfx_sigh.mp3" /> |
| `<\|sfx:sniff\|>` | Sniff | `<\|sfx:sniff\|>Sff..., it's so cold out, my nose won't stop.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/sfx_sniff.mp3" /> |
| `<\|sfx:sneeze\|>` | Sneeze | `<\|sfx:sneeze\|>Achoo! Bless you, oh wait, that was me.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/sfx_sneeze.mp3" /> |

## Prosody

Prosody tags control speed, pitch, pauses, and overall expressiveness.

| Tag | Effect | Sample input | Sample audio |
| - | - | - | - |
| `<\|prosody:speed_very_slow\|>` | \~0.65× speed | `<\|prosody:speed_very_slow\|>Take your time, <\|prosody:pause\|> there is, <\|prosody:pause\|> really no need <\|prosody:pause\|> to rush <\|prosody:pause\|> at all.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/prosody_speed_very_slow.mp3" /> |
| `<\|prosody:speed_slow\|>` | \~0.85× speed | `<\|prosody:speed_slow\|>Let me explain this slowly, so everyone can follow along.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/prosody_speed_slow.mp3" /> |
| `<\|prosody:speed_fast\|>` | \~1.2× speed | `<\|prosody:speed_fast\|>Quick, quick, we have to go right now, we're running late!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/prosody_speed_fast.mp3" /> |
| `<\|prosody:speed_very_fast\|>` | \~1.4× speed | `<\|prosody:speed_very_fast\|>Wait wait wait, two minutes till the train, no time to talk, just run run, go go go!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/prosody_speed_very_fast.mp3" /> |
| `<\|prosody:pitch_low\|>` | \~−3 semitones | `<\|prosody:pitch_low\|>In a deep and serious voice, he delivered the grave news.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/prosody_pitch_low.mp3" /> |
| `<\|prosody:pitch_high\|>` | \~+2.5 semitones | `<\|prosody:pitch_high\|>Oh hello there little one, aren't you just the cutest!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/prosody_pitch_high.mp3" /> |
| `<\|prosody:pause\|>` | \~400–700 ms pause | `Wait for it <\|prosody:pause\|> and there it is, the big reveal.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/prosody_pause.mp3" /> |
| `<\|prosody:long_pause\|>` | \~700–1500 ms pause | `I have something important to tell you. <\|prosody:long_pause\|> I'm leaving tomorrow.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/prosody_long_pause.mp3" /> |
| `<\|prosody:expressive_high\|>` | More expressive delivery | `<\|prosody:expressive_high\|>This is incredible, absolutely magnificent, beyond my wildest dreams!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/prosody_expressive_high.mp3" /> |
| `<\|prosody:expressive_low\|>` | Flatter delivery | `<\|prosody:expressive_low\|>The meeting is at noon. Bring your reports. That's all.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/prosody_expressive_low.mp3" /> |

## Other

| Tag | Effect | Sample input | Sample audio |
| - | - | - | - |
| `<\|reset\|>` | Resets to neutral delivery | `<\|emotion:sadness\|><\|prosody:speed_slow\|>She waited by the window every night, hoping he would come home. But the seasons changed, the years went by, and he never did. <\|reset\|>That concludes chapter three. Chapter four begins on the next page.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tags/other_reset.mp3" /> |


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.