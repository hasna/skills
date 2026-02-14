/**
 * AI-powered slide generation
 */

import OpenAI from "openai";
import { Presentation, SlideOptions } from "./parse.js";

export async function generateSlidesWithAI(options: SlideOptions): Promise<Presentation> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for AI generation");
  }

  const openai = new OpenAI({ apiKey });

  console.log("🤖 Generating slides with AI...");
  console.log(`   Topic: ${options.topic}`);
  console.log(`   Slides: ${options.slideCount}`);
  console.log(`   Audience: ${options.audience}`);
  console.log(`   Style: ${options.style}`);

  const systemPrompt = `You are an expert presentation designer. Create engaging, well-structured slide content.
Return ONLY valid JSON with no additional text or markdown formatting.`;

  const userPrompt = `Create EXACTLY ${options.slideCount} slides for a presentation about: "${options.topic}"

IMPORTANT: You MUST create exactly ${options.slideCount} slides - no more, no less.

Target audience: ${options.audience}
Style: ${options.style}
Language: ${options.language}
Include speaker notes: ${options.notes}

Return a JSON object with this exact structure:
{
  "title": "Main presentation title",
  "subtitle": "Optional subtitle",
  "slides": [
    {
      "type": "title",
      "title": "Slide title",
      "subtitle": "Optional subtitle for title slide",
      "content": [],
      "notes": "Speaker notes for this slide"
    },
    {
      "type": "bullets",
      "title": "Slide Title",
      "content": ["Bullet point 1", "Bullet point 2", "Bullet point 3"],
      "notes": "Speaker notes"
    },
    {
      "type": "two-column",
      "title": "Comparison Title",
      "columns": {
        "left": ["Left point 1", "Left point 2"],
        "right": ["Right point 1", "Right point 2"]
      },
      "notes": "Speaker notes"
    },
    {
      "type": "quote",
      "title": "Key Insight",
      "content": ["The quote or key message here"],
      "notes": "Speaker notes"
    }
  ]
}

Slide types available: title, bullets, content, two-column, quote, image
- First slide should be type "title"
- Last slide should be a conclusion/thank you
- Use variety of slide types
- Keep bullet points concise (5-8 words each)
- Include 3-5 bullet points per slide
- Make content engaging and valuable`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4000,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || "";

    // Extract JSON from response
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    // Clean up common issues
    jsonStr = jsonStr.trim();
    if (!jsonStr.startsWith("{")) {
      const startIdx = jsonStr.indexOf("{");
      if (startIdx !== -1) {
        jsonStr = jsonStr.substring(startIdx);
      }
    }

    const data = JSON.parse(jsonStr);

    let slides = data.slides || [];
    const targetCount = options.slideCount || 5;

    // Enforce slide count - trim if too many
    if (slides.length > targetCount) {
      console.log(`   ⚠️  AI generated ${slides.length} slides, trimming to ${targetCount}`);
      // Keep title slide (first) and conclusion (last), trim from middle
      if (slides.length > 2) {
        const titleSlide = slides[0];
        const conclusionSlide = slides[slides.length - 1];
        const middleSlides = slides.slice(1, -1).slice(0, targetCount - 2);
        slides = [titleSlide, ...middleSlides, conclusionSlide];
      } else {
        slides = slides.slice(0, targetCount);
      }
    }

    console.log(`   ✓ Generated ${slides.length} slides`);

    return {
      title: data.title || options.topic || "Presentation",
      subtitle: data.subtitle,
      author: options.author,
      date: options.date,
      slides,
      metadata: { generatedBy: "AI", topic: options.topic },
    };
  } catch (error: any) {
    console.error("AI generation error:", error.message);
    throw new Error(`Failed to generate slides: ${error.message}`);
  }
}
