// The copilot's quote-fact parsers (public/hp-quote-facts.js): what a client says, turned into quoter values.
await import("../public/hp-quote-facts.js");
const X = globalThis.HP_QFACTS;

const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = new Date(2026, 9, 20); // Oct 20, 2026

// birthday -> age last birthday
ok(X.checkDob({ m: "03", d: "04", y: "1958" }, NOW).age === 68, "age last birthday: born 3/4/1958 is 68 on 10/20/2026");
ok(X.checkDob({ m: "10", d: "21", y: "1958" }, NOW).age === 67, "age last birthday: the day before the birthday is still 67");
ok(X.checkDob({ m: "10", d: "20", y: "1958" }, NOW).age === 68, "age last birthday: on the birthday it's 68");
ok(X.checkDob({ m: "02", d: "31", y: "1958" }, NOW).err === "bad", "2/31 is not a real date");
ok(X.checkDob({ m: "02", d: "29", y: "1957" }, NOW).err === "bad" && X.checkDob({ m: "02", d: "29", y: "1956" }, NOW).age === 70, "Feb 29 only in leap years");
ok(X.checkDob({ m: "13", d: "01", y: "1958" }, NOW).err === "bad", "month 13 is not a real date");
ok(X.checkDob({ m: "01", d: "01", y: "2030" }, NOW).err === "future", "a future birthday is flagged");
ok(X.checkDob({ m: "01", d: "01", y: "58" }, NOW).err === "bad", "a two-digit year isn't a full date");
ok(X.dobAge({ m: "", d: "", y: "" }, NOW) === null, "an empty birthday has no age");

// date of birth said on a call
ok(eq(X.parseDob("I was born March 4th 1958", "", NOW), { m: "03", d: "04", y: "1958" }), "DOB: born March 4th 1958");
ok(eq(X.parseDob("March 4th, 1958", "And what's your date of birth?", NOW), { m: "03", d: "04", y: "1958" }), "DOB: bare answer to the date-of-birth question");
ok(eq(X.parseDob("My birthday is the 4th of March, 1958", "", NOW), { m: "03", d: "04", y: "1958" }), "DOB: the 4th of March, 1958");
ok(eq(X.parseDob("I was born on march fourth nineteen fifty eight", "", NOW), { m: "03", d: "04", y: "1958" }), "DOB: spelled out");
ok(eq(X.parseDob("date of birth is 3/4/58", "", NOW), { m: "03", d: "04", y: "1958" }), "DOB: 3/4/58 with a two-digit year");
ok(eq(X.parseDob("Born December 31, 1949", "", NOW), { m: "12", d: "31", y: "1949" }), "DOB: December 31, 1949");
ok(X.parseDob("My policy started March 4th 2010", "", NOW) === null, "DOB: a date that isn't a birthday is ignored");
ok(X.parseDob("I was born February 31st 1958", "", NOW) === null, "DOB: an impossible date is ignored");
ok(X.parseDob("I was born in the fifties", "", NOW) === null, "DOB: no full date, no DOB");

// age
ok(X.parseAge("I'm 67") === 67, "age: I'm 67");
ok(X.parseAge("well I'm sixty-seven years old") === 67, "age: sixty-seven years old");
ok(X.parseAge("I am actually 72 years old now") === 72, "age: I am actually 72 years old");
ok(X.parseAge("I just turned 65 last month") === 65, "age: just turned 65");
ok(X.parseAge("Sixty eight.", "And how old are you?") === 68, "age: bare answer to how old");
ok(X.parseAge("I'm in my sixties") === null, "age: in my sixties is too vague");
ok(X.parseAge("I'm 67 or 68") === null, "age: two numbers is ambiguous");
ok(X.parseAge("I'm 20 minutes away") === null, "age: minutes aren't an age");
ok(X.parseAge("I'm 190 pounds") === null, "age: a weight isn't an age");
ok(X.parseAge("I'm five ten") === null, "age: a height isn't an age");
ok(X.parseAge("when I'm 70 I want it paid off") === null, "age: a future age isn't the age");
ok(X.parseAge("my wife is 65") === null, "age: someone else's age is ignored");

// height and weight
ok(eq(X.parseHW("I'm five ten, about 190"), { ft: 5, inch: 10, lb: 190 }), "height/weight: five ten, about 190");
ok(eq(X.parseHW("I'm 5'10\" and 190 pounds"), { ft: 5, inch: 10, lb: 190 }), "height/weight: 5'10\" and 190 pounds");
ok(eq(X.parseHW("about five foot two"), { ft: 5, inch: 2 }), "height: five foot two");
ok(eq(X.parseHW("6 feet"), { ft: 6, inch: 0 }), "height: 6 feet");
ok(eq(X.parseHW("I weigh around two hundred and ten"), { lb: 210 }), "weight: two hundred and ten");
ok(eq(X.parseHW("one eighty five", "And what do you weigh?"), { lb: 185 }), "weight: bare answer to the weight question");
ok(eq(X.parseHW("five six", "How tall are you?"), { ft: 5, inch: 6 }), "height: bare answer to how tall");
ok(X.parseHW("I pay about 190 a month") === null, "weight: a bare number with no height or question is ignored");
ok(X.hwText({ ft: 5, inch: 10, lb: 190 }) === `5'10", 190 lbs`, "height/weight text matches the copilot's format");

// tobacco
ok(X.parseTobacco("no I don't smoke") === "No", "tobacco: no I don't smoke");
ok(X.parseTobacco("No.", "Have you used any tobacco or nicotine in the last 12 months?") === "No", "tobacco: bare no to the tobacco question");
ok(X.parseTobacco("yeah about a pack a day") === "Yes", "tobacco: a pack a day");
ok(X.parseTobacco("I don't smoke but I vape") === "Yes (vape)", "tobacco: vaping is nicotine");
ok(X.parseTobacco("I quit smoking 5 years ago") === "No (quit 5 years ago)", "tobacco: quit 5 years ago");
ok(X.parseTobacco("I quit smoking a few months ago") === "Yes (quit under a year ago)", "tobacco: quit under a year ago still counts");
ok(X.parseTobacco("I quit my job last year") === null, "tobacco: quitting a job isn't tobacco");
ok(X.parseTobacco("I smoke a little weed") === "No (marijuana only)", "tobacco: marijuana only");
ok(X.nicOf("Yes (vape)") === "vape" && X.nicOf("Yes") === "cig" && X.nicOf("No") === "none" && X.nicOf("No (marijuana only)") === "mj", "tobacco -> the quoter's nicotine type");

// sex
ok(X.parseSex("I'm a woman") === "F" && X.parseSex("Male", "Male or female?") === "M", "sex: stated or answered");
ok(X.parseSex("I'm a man of my word") === null, "sex: a figure of speech is ignored");
ok(X.parseSex("he's a good man") === null, "sex: someone else is ignored");

// state / ZIP
ok(eq(X.parseState("I'm down in Florida"), { state: "FL" }), "state: down in Florida");
ok(eq(X.parseState("we live in North Carolina"), { state: "NC" }), "state: two-word state");
ok(eq(X.parseState("Texas.", "And what state are you in?"), { state: "TX" }), "state: bare answer");
ok(eq(X.parseState("my zip is 33101"), { state: "FL", zip: "33101" }), "ZIP -> state");
ok(X.zipState("10001") === "NY" && X.zipState("90210") === "CA" && X.zipState("73301") === "TX" && X.zipState("00901") === null, "ZIP prefixes");
ok(X.parseState("my daughter lives in Ohio") === null, "state: where someone else lives is ignored");
ok(X.parseState("I'm in my sixties") === null, "state: 'in my' isn't a state");
ok(X.parseState("I was in Georgia last week") === null, "state: a trip isn't where they live");

// mortgage: years left -> term
ok(X.parseYearsLeft("about 20 years left on the mortgage") === 20, "years left: 20 years left on the mortgage");
ok(X.parseYearsLeft("it'll be paid off in fifteen years") === 15, "years left: paid off in fifteen years");
ok(X.parseYearsLeft("I've got 10 years left until retirement") === null, "years left: not about the mortgage");
ok(X.termFor(18) === 20 && X.termFor(10) === 10 && X.termFor(35) === 30, "years left -> shortest term that covers it");

// IUL goal
ok(X.parseGoal("mostly retirement income") === "Retirement income / cash value" && X.focusOf("Retirement income / cash value") === "cash", "IUL goal: retirement");
ok(X.parseGoal("Both, I guess", "Is this mostly for protection, retirement income, or both?") === "Protection + retirement income" && X.focusOf("Protection + retirement income") === "balanced", "IUL goal: both");
ok(X.parseGoal("just protection for my family") === "Protection" && X.focusOf("Protection") === "protection", "IUL goal: protection");
