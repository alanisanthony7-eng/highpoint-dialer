/* Creamteam IUL framework, as written by Anthony. Placeholders stay [Name] / [Carrier] / [amount]
   and also accept {name} so an open lead fills Hey [Name]. Notes are for the agent, not read aloud. */
window.HP_IUL = {
  title: "Creamteam IUL Framework",
  stages: [
    { title: "Tax talk", items: [
      { k: "say", x: "Tax code 7702 states that life insurance is not a taxable asset. So when they pull from this policy" },
      { k: "say", x: "With 401k’s, as you know withdrawals are taxed as ordinary income, so annually that’s 30-40% of what you’ve already brought in. So having something on top of that to supplement is a great way to be able to have it diversified, that way you don’t have all your eggs in one basket, because worst part is, people work for 20-40 years then the market flips upside down and people lose their entire portfolio, that’s why IUL’s are great because when done the right way, it protects that money that you started off with the 0% floor." },
      { k: "note", x: "Show illustration, explain how they’ll be able to use the policy the RIGHT way. Ask what their main goal was (cash value / protection / both)." }
    ] },
    { title: "Open", items: [
      { k: "say", x: "Hey [Name]?" },
      { k: "say", x: "Hey , yea hey  this is Anthony, im trying to send you your portfolio on the IUL illustration you were looking in to, Just wanted to clarify with you here real quick was it for the cash value growth or the protection side of it." },
      { k: "say", x: "Okay gotcha sounds good, so the nice thing with an Indexed Universal Life policy is there are a couple different ways we can structure it depending on what you actually want it to do for you." }
    ] },
    { title: "Discovery", items: [
      { k: "h", x: "If protection" },
      { k: "say", x: "Okay so since you’re more focusing on protection, Is it mainly replacing your income for the family, paying off a mortgage, leaving money to the kids, or is there something else you specifically want taken care of?" },
      { k: "h", x: "If cash value" },
      { k: "say", x: "Okay, so since you’re more focusing on cash growth, let me understand what you actually want the money for. Are you thinking more along the lines of building something for retirement, using it alongside your business, leaving money behind later on, or what were you picturing?" },
      { k: "say", x: "Do you have anything in place right now - 401k, Roth, Life insurance, pension…? Or is this the first thing you’re setting up?" },
      { k: "say", x: "What have they tried in the past? How’s it going for you?" },
      { k: "say", x: "What are your goals? Why are you doing this?" },
      { k: "note", x: "Kids? Spouse? Who are they doing this for? What happens if they DON'T fix their issue?" }
    ] },
    { title: "How an IUL works", items: [
      { k: "say", x: "Do you kinda know how that IUL works or do you need a quick refresher?" },
      { k: "note", x: "Even if they say no, still refresh them (build value). It works 3 ways." },
      { k: "say", x: "It works 3 ways" },
      { k: "say", x: "1. Death benefit ($50,000 - $500,000)" },
      { k: "say", x: "2. Monthly premium is invested into the cash value account that grows with the stock market, typically the s&p500 at a 10-12% rate each year, with a 0% floor so you’ll never lose money." },
      { k: "say", x: "3. Living benefits - allows you to access that life insurance money while you are still here" },
      { k: "note", x: "Before the close: reiterate their WHY, push the pain, hype up solution, start app." }
    ] },
    { title: "Example application", items: [
      { k: "note", x: "Confirm DOB. Start with $200/mo. Show initial death benefit. Show death benefit at 80/90 years old. Talk about tax free cash value at 5, 10 years from now & retirement age/80 years of age." },
      { k: "say", x: "Now [Name] this is just assuming a 5.5% interest rate, thats all im legally allowed to show you" },
      { k: "say", x: "You can do a quick Google search and see that the market does do around 8-12% per year" },
      { k: "say", x: "Now [Name], I can’t guarantee you that it will be that high… buttttt history repeats itself right??" },
      { k: "say", x: "Like I said [Name], these numbers are based on just $100/mo, would you like to see what $200 or $300 looks like or is $100 comfortable to you?" }
    ] },
    { title: "Getting approved", items: [
      { k: "h", x: "Preface on getting approved" },
      { k: "say", x: "Now [Name], this is contingent on getting approved" },
      { k: "say", x: "Most of my clients ask me, “hey Anthony, what's the catch, this seems too good to be true”" },
      { k: "say", x: "To be honest [Name], It just comes down to being healthy enough" },
      { k: "h", x: "Preface on starter IUL or cash value whole" },
      { k: "say", x: "If we don't get you approved, we will get you set up on a starter IUL, “its like getting the BMW before the Ferrari”" },
      { k: "say", x: "It’s just to build our relationship with the insurance carrier" },
      { k: "say", x: "They want to see that you are paying your monthly premiums and remaining healthy and then in 11-12 months we can offer you the full IUL" },
      { k: "say", x: "to to that I just need run you through some questions to see IF we can get you approved" },
      { k: "note", x: "And to do that… go to underwriting." }
    ] },
    { title: "Underwriting", items: [
      { k: "note", x: "The application pretty much takes you from here. Build up for social." },
      { k: "say", x: "Was there any cigarettes or tobacco usage for you [Name]?" },
      { k: "say", x: "And how’s your health overall—any COPD, diabetes, cancer, kidney issues, or congestive heart failure?" },
      { k: "say", x: "Any heart attacks, strokes, seizures, stents, or bypasses?" },
      { k: "say", x: "Any Alzheimer’s, dementia, or neurological issues?" },
      { k: "say", x: "And what medications are you currently taking?" },
      { k: "say", x: "Who is your primary care physician" },
      { k: "note", x: "Get social. Ask all questions prompted on application." }
    ] },
    { title: "Decision", items: [
      { k: "h", x: "IUL" },
      { k: "say", x: "Okay perfect [Name]" },
      { k: "say", x: "It looks like we got you fully approved for that IUL today" },
      { k: "say", x: "Congratulations most people dont get immediately approved" },
      { k: "say", x: "Who would be the beneficiary of your policy that you want to leave all this money behind to?" },
      { k: "note", x: "Build rapport." },
      { k: "h", x: "Starter IUL" },
      { k: "say", x: "Okay [Name] so it looks like just due to the [diabetes] we are going to get you set up on a preferred rate starter IUL today and in 11/12 months we will get you on the full IUL" },
      { k: "say", x: "Who was going to be the beneficiary of your policy that would be getting all this money if something happened to you?" }
    ] },
    { title: "Solidification", items: [
      { k: "say", x: "Now [Name], I assume we want this to go into effect as soon as possible, correct?" },
      { k: "say", x: "Just to recap what we did today: we applied for that Indexed Universal Life policy with [Carrier], giving you [Face Amount] in lifetime coverage with cash value growth tied to the S&P 500. Your monthly contribution is $[amount], and it starts [date]." },
      { k: "say", x: "Your welcome packet will arrive in about a week with all policy details inside. Keep an eye out for that." },
      { k: "say", x: "I just want to make sure — that start date and monthly amount are comfortable for you, correct?" },
      { k: "note", x: "Pause and confirm." },
      { k: "say", x: "Perfect. Now before I let you go, who else in your family might want to take advantage of this type of tax-free protection and growth plan? I can help them get set up with the same benefits while rates are low." }
    ] }
  ]
};
