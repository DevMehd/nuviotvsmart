/**
 * Pure port of mobile RecommendationEngine.kt and TasteModel.kt (302fe2ac).
 * No storage, network or UI dependencies: callers supply normalised TitleFeatures
 * and WatchSignals. Maps are plain JSON objects; key sets are JS Sets.
 *
 * TitleFeatures: { type, id, name, poster?, genres?, directors?, cast?, country?,
 *   language?, year?, runtimeMinutes?, rating?, votes? }.
 * WatchSignal: { key: "type:id", watchedMs, durationMs, completed, endedAtMs }.
 * Recommendation: { title, score, similarity, quality, reason } where reason is
 *   { type: "watched", title, similarity }, { type: "genre", genre } or
 *   { type: "popular" }. Kotlin Pair values use [first, second] arrays.
 * Taste models retain the mobile JSON shape and are safe to store as JSON.
 */

const DAY_MS = 86_400_000;
const HALF_LIFE_DAYS = 60;
const MAX_CAST = 5;
const LIBRARY_WEIGHT = 0.6;
const LIKE_WEIGHT = 1;
const ABANDON_WEIGHT = -0.4;
const SIM_WEIGHT = 0.7;
const QUALITY_WEIGHT = 0.2;
const NOVELTY_WEIGHT = 0.1;
const MMR_LAMBDA = 0.75;
const BAYES_PRIOR_MEAN = 6.8;
const BAYES_PRIOR_VOTES = 500;
const REASON_MIN_SIMILARITY = 0.3;
const IMPLICIT_WITH_RATING = 0.3;
const DISLIKE_PENALTY = 0.45;
const DISLIKE_THRESHOLD = -1;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const sum = (values) => values.reduce((total, value) => total + value, 0);
const normOf = (vector) => Math.sqrt(sum(Object.values(vector).map((value) => value * value)));
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const descending = (object) => Object.entries(object).sort((a, b) => b[1] - a[1]);

export const titleKey = (title) => `${title.type}:${title.id}`;

/** Convert a stored five-level rating to its engine weight; null means removed. */
export function ratingWeight(value) {
  return Number.isInteger(value) && value >= -2 && value <= 2
    ? [-2.5, -1.2, 0.3, 1.6, 3.2][value + 2]
    : null;
}

function norm(value) {
  return value.trim().toLowerCase();
}

function decay(ageMs) {
  return Math.exp((-Math.log(2) * Math.max(0, ageMs)) / DAY_MS / HALF_LIFE_DAYS);
}

function isAbandoned(sessions, nowMs) {
  if (!sessions.length || sessions.some((session) => session.completed)) return false;
  const duration = Math.max(...sessions.map((session) => session.durationMs));
  if (duration <= 0) return false;
  const watched = sum(sessions.map((session) => session.watchedMs));
  const last = Math.max(...sessions.map((session) => session.endedAtMs));
  return watched < duration * 0.25 && nowMs - last > 21 * DAY_MS;
}

/** ratings contains engine weights, not raw -2..2 values (use ratingWeight). */
function interactionWeights(
  sessions,
  nowMs,
  libraryKeys = new Set(),
  likedKeys = new Set(),
  ratings = {}
) {
  const groups = new Map();
  for (const session of sessions) {
    if (!groups.has(session.key)) groups.set(session.key, []);
    groups.get(session.key).push(session);
  }
  const weights = {};
  for (const [key, group] of groups) {
    if (isAbandoned(group, nowMs)) {
      weights[key] = ABANDON_WEIGHT;
      continue;
    }
    const weight = sum(
      group.map((session) => {
        const hours = session.watchedMs / 3_600_000;
        const completion = session.completed
          ? 1
          : session.durationMs > 0
            ? clamp(session.watchedMs / session.durationMs, 0, 1)
            : 0.5;
        return Math.log1p(hours) * (0.5 + completion) * decay(nowMs - session.endedAtMs);
      })
    );
    if (weight > 0) weights[key] = weight;
  }
  for (const key of libraryKeys) weights[key] = (weights[key] ?? 0) + LIBRARY_WEIGHT;
  for (const key of likedKeys) weights[key] = (weights[key] ?? 0) + LIKE_WEIGHT;
  for (const [key, rated] of Object.entries(ratings)) {
    weights[key] = rated + IMPLICIT_WITH_RATING * Math.max(0, weights[key] ?? 0);
  }
  return weights;
}

function runtimeBucket(minutes) {
  return minutes < 30 ? "short" : minutes < 60 ? "episode" : minutes < 110 ? "film" : "long";
}

function rawFeatures(title) {
  const features = {};
  for (const genre of title.genres || []) features[`g:${norm(genre)}`] = 1;
  for (const director of title.directors || []) features[`d:${norm(director)}`] = 1.2;
  for (const actor of (title.cast || []).slice(0, MAX_CAST)) features[`p:${norm(actor)}`] = 0.8;
  if (title.year != null) features[`y:${Math.trunc(title.year / 10) * 10}`] = 0.5;
  for (const country of (title.country || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    features[`c:${norm(country)}`] = 0.4;
  }
  if (title.language?.trim()) features[`l:${norm(title.language)}`] = 0.4;
  if (title.runtimeMinutes != null) features[`r:${runtimeBucket(title.runtimeMinutes)}`] = 0.3;
  features[`t:${norm(title.type)}`] = 0.3;
  return features;
}

function idf(corpus) {
  const frequencies = {};
  for (const title of corpus) {
    for (const key of Object.keys(rawFeatures(title)))
      frequencies[key] = (frequencies[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(frequencies).map(([key, frequency]) => [
      key,
      Math.log((corpus.length + 1) / (frequency + 1)) + 1
    ])
  );
}

function normalize(vector) {
  const length = normOf(vector);
  return length === 0
    ? vector
    : Object.fromEntries(Object.entries(vector).map(([key, weight]) => [key, weight / length]));
}

function vector(title, inverseFrequencies) {
  const values = Object.values(inverseFrequencies);
  const fallback = values.length ? Math.max(...values) : 1;
  return normalize(
    Object.fromEntries(
      Object.entries(rawFeatures(title)).map(([key, weight]) => [
        key,
        weight * (inverseFrequencies[key] ?? fallback)
      ])
    )
  );
}

function cosine(a, b) {
  const [small, large] = Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  const product = sum(Object.entries(small).map(([key, weight]) => weight * (large[key] ?? 0)));
  const lengthA = normOf(a);
  const lengthB = normOf(b);
  return lengthA === 0 || lengthB === 0 ? 0 : product / (lengthA * lengthB);
}

function profile(weights, vectors) {
  const result = {};
  for (const [key, weight] of Object.entries(weights)) {
    for (const [feature, value] of Object.entries(vectors[key] || {})) {
      result[feature] = (result[feature] ?? 0) + weight * value;
    }
  }
  return normalize(Object.fromEntries(Object.entries(result).filter(([, value]) => value > 0)));
}

function quality(rating, votes) {
  if (rating == null) return 0.4;
  const count = votes ?? 0;
  const bayes =
    (count / (count + BAYES_PRIOR_VOTES)) * rating +
    (BAYES_PRIOR_VOTES / (count + BAYES_PRIOR_VOTES)) * BAYES_PRIOR_MEAN;
  return clamp((bayes - 5) / 5, 0, 1);
}

function novelty(year, currentYear) {
  if (year == null) return 0.3;
  const age = currentYear - year;
  return age <= 1 ? 1 : age <= 4 ? 0.6 : age <= 15 ? 0.3 : 0.1;
}

function reason(candidate, candidateTitle, seen, tasteProfile) {
  let best = null;
  for (const [title, titleVector] of seen) {
    const similarity = cosine(candidate, titleVector);
    if (best == null || similarity > best.similarity)
      best = { type: "watched", title: title.name, similarity };
  }
  if (best != null && best.similarity >= REASON_MIN_SIMILARITY) return best;
  const genre = [...(candidateTitle.genres || [])].sort(
    (a, b) => (tasteProfile[`g:${norm(b)}`] ?? 0) - (tasteProfile[`g:${norm(a)}`] ?? 0)
  )[0];
  return genre != null && (tasteProfile[`g:${norm(genre)}`] ?? 0) > 0
    ? { type: "genre", genre }
    : { type: "popular" };
}

/** scored is an array of [Recommendation, featureVector] pairs. Stable ties match Kotlin. */
function mmr(scored, limit, lambda = MMR_LAMBDA) {
  const pool = [...scored].sort((a, b) => b[0].score - a[0].score);
  const picked = [];
  while (picked.length < limit && pool.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    pool.forEach(([recommendation, titleVector], index) => {
      const similarities = picked.map(([, pickedVector]) => cosine(titleVector, pickedVector));
      const redundancy = similarities.length ? Math.max(...similarities) : 0;
      const score = lambda * recommendation.score - (1 - lambda) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    picked.push(pool.splice(bestIndex, 1)[0]);
  }
  return picked.map(([recommendation]) => recommendation);
}

function isColdStart(weights) {
  const positive = Object.values(weights).filter((weight) => weight > 0);
  return positive.length < 3 || sum(positive) < 1.5;
}

function distinctTitles(titles) {
  const seen = new Set();
  return titles.filter((title) => {
    const key = titleKey(title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rank(weights, seen, candidates, exclude, currentYear, limit = 20, libraryGenres = {}) {
  const pool = distinctTitles(candidates).filter(
    (title) => !exclude.has(titleKey(title)) && !has(weights, titleKey(title))
  );
  if (!pool.length) return [];
  const corpus = distinctTitles([...seen, ...pool]);
  const inverseFrequencies = idf(corpus);
  const vectors = Object.fromEntries(
    corpus.map((title) => [titleKey(title), vector(title, inverseFrequencies)])
  );
  if (isColdStart(weights)) return coldStart(pool, vectors, libraryGenres, limit);
  const tasteProfile = profile(weights, vectors);
  const seenVectors = seen
    .filter((title) => (weights[titleKey(title)] ?? 0) > 0)
    .map((title) => [title, vectors[titleKey(title)]]);
  const dislikedVectors = seen
    .filter((title) => (weights[titleKey(title)] ?? 0) <= DISLIKE_THRESHOLD)
    .map((title) => vectors[titleKey(title)]);
  const scored = pool.map((title) => {
    const titleVector = vectors[titleKey(title)];
    const similarity = cosine(tasteProfile, titleVector);
    const q = quality(title.rating, title.votes);
    const closestDislike = Math.max(
      0,
      ...dislikedVectors.map((dislike) => cosine(dislike, titleVector))
    );
    const score =
      SIM_WEIGHT * similarity +
      QUALITY_WEIGHT * q +
      NOVELTY_WEIGHT * novelty(title.year, currentYear) -
      DISLIKE_PENALTY * closestDislike;
    return [
      {
        title,
        score,
        similarity,
        quality: q,
        reason: reason(titleVector, title, seenVectors, tasteProfile)
      },
      titleVector
    ];
  });
  return mmr(scored, limit);
}

function affinities(weights, seen) {
  if (!seen.length)
    return Object.fromEntries(
      Object.entries(weights).map(([key, weight]) => [key, Math.tanh(weight / 2)])
    );
  const inverseFrequencies = idf(seen);
  const vectors = Object.fromEntries(
    seen.map((title) => [titleKey(title), vector(title, inverseFrequencies)])
  );
  const tasteProfile = profile(weights, vectors);
  return Object.fromEntries(
    [...new Set([...Object.keys(weights), ...Object.keys(vectors)])].map((key) => {
      const direct = Math.tanh((weights[key] ?? 0) / 2);
      const similarity = vectors[key] ? cosine(tasteProfile, vectors[key]) : 0;
      return [key, clamp(0.7 * direct + 0.3 * similarity, -1, 1)];
    })
  );
}

function coldStart(pool, vectors, libraryGenres, limit) {
  const total = Math.max(1, sum(Object.values(libraryGenres)));
  const scored = pool.map((title) => {
    const genres = title.genres || [];
    const overlap = Math.min(
      1,
      sum(genres.map((genre) => libraryGenres[norm(genre)] ?? 0)) / total
    );
    const q = quality(title.rating, title.votes);
    const genre = [...genres].sort(
      (a, b) => (libraryGenres[norm(b)] ?? 0) - (libraryGenres[norm(a)] ?? 0)
    )[0];
    const why =
      genre != null && (libraryGenres[norm(genre)] ?? 0) > 0
        ? { type: "genre", genre }
        : { type: "popular" };
    return [
      { title, score: 0.5 * overlap + 0.5 * q, similarity: overlap, quality: q, reason: why },
      vectors[titleKey(title)]
    ];
  });
  return mmr(scored, limit);
}

function genreCounts(titles) {
  const counts = {};
  for (const title of titles) {
    for (const genre of title.genres || []) counts[norm(genre)] = (counts[norm(genre)] ?? 0) + 1;
  }
  return counts;
}

function topGenres(tasteProfile, count) {
  return Object.entries(tasteProfile)
    .filter(([key]) => key.startsWith("g:"))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, count)
    .map(([key]) => key.slice(2));
}

export const RecommendationEngine = Object.freeze({
  HALF_LIFE_DAYS,
  MAX_CAST,
  LIBRARY_WEIGHT,
  LIKE_WEIGHT,
  ABANDON_WEIGHT,
  SIM_WEIGHT,
  QUALITY_WEIGHT,
  NOVELTY_WEIGHT,
  MMR_LAMBDA,
  BAYES_PRIOR_MEAN,
  BAYES_PRIOR_VOTES,
  REASON_MIN_SIMILARITY,
  IMPLICIT_WITH_RATING,
  DISLIKE_PENALTY,
  DISLIKE_THRESHOLD,
  decay,
  isAbandoned,
  interactionWeights,
  norm,
  rawFeatures,
  idf,
  vector,
  normalize,
  cosine,
  profile,
  quality,
  novelty,
  reason,
  mmr,
  isColdStart,
  rank,
  affinities,
  coldStart,
  genreCounts,
  topGenres
});

/** Same defaults as mobile TasteModel(); useful before a profile has any signals. */
export function emptyTasteModel(builtAtMs = 0) {
  return { profile: {}, idf: {}, idfDefault: 1, dislikes: [], labels: {}, builtAtMs };
}

function build(weights, seen, nowMs) {
  if (!seen.length) return emptyTasteModel(nowMs);
  const inverseFrequencies = idf(seen);
  const vectors = Object.fromEntries(
    seen.map((title) => [titleKey(title), vector(title, inverseFrequencies)])
  );
  const tasteProfile = Object.fromEntries(descending(profile(weights, vectors)).slice(0, 400));
  const dislikes = seen
    .filter((title) => (weights[titleKey(title)] ?? 0) <= DISLIKE_THRESHOLD)
    .slice(0, 30)
    .map((title) => vectors[titleKey(title)]);
  const labels = {};
  for (const title of seen) {
    for (const genre of title.genres || []) labels[`g:${norm(genre)}`] = genre;
    for (const director of title.directors || []) labels[`d:${norm(director)}`] = director;
    for (const actor of title.cast || []) labels[`p:${norm(actor)}`] = actor;
    for (const country of (title.country || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean))
      labels[`c:${norm(country)}`] = country;
    if (title.language != null) labels[`l:${norm(title.language)}`] = title.language;
  }
  return {
    profile: tasteProfile,
    idf: Object.fromEntries(descending(inverseFrequencies).slice(0, 3000)),
    idfDefault: Math.max(...Object.values(inverseFrequencies)),
    dislikes,
    labels: Object.fromEntries(Object.entries(labels).filter(([key]) => has(tasteProfile, key))),
    builtAtMs: nowMs
  };
}

function predict(model, title) {
  if (!Object.keys(model.profile).length) return null;
  const titleVector = normalize(
    Object.fromEntries(
      Object.entries(rawFeatures(title)).map(([key, weight]) => [
        key,
        weight * (model.idf[key] ?? model.idfDefault)
      ])
    )
  );
  if (!Object.keys(titleVector).length) return null;
  const similarity = cosine(model.profile, titleVector);
  const q = quality(title.rating, title.votes);
  const dislike = Math.max(0, ...model.dislikes.map((value) => cosine(value, titleVector)));
  const raw = 0.75 * similarity + 0.25 * q - DISLIKE_PENALTY * dislike;
  const percent = clamp(Math.trunc(100 / (1 + Math.exp(-(raw - 0.22) * 9))), 1, 99);
  const reasons = Object.keys(titleVector)
    .filter((key) => has(model.profile, key))
    .sort((a, b) => model.profile[b] * titleVector[b] - model.profile[a] * titleVector[a])
    .filter((key) => key.startsWith("g:") || key.startsWith("d:") || key.startsWith("p:"))
    .slice(0, 3);
  return { percent, reasons, warning: dislike > 0.5 };
}

/** Each portrait family is an array of [displayLabel, relativeStrength] pairs. */
function portrait(model, top = 6) {
  const family = (prefix) => {
    const entries = descending(model.profile)
      .filter(([key]) => key.startsWith(prefix))
      .slice(0, top);
    if (!entries.length) return [];
    return entries.map(([key, weight]) => {
      const suffix = key.slice(key.indexOf(":") + 1);
      const label = model.labels[key] ?? suffix.charAt(0).toUpperCase() + suffix.slice(1);
      return [label, clamp(Math.trunc((weight / entries[0][1]) * 100), 1, 100)];
    });
  };
  const decades = descending(model.profile)
    .filter(([key]) => key.startsWith("y:"))
    .slice(0, 4);
  const runtime = descending(model.profile).find(([key]) => key.startsWith("r:"));
  return {
    genres: family("g:"),
    directors: family("d:"),
    cast: family("p:"),
    decades: decades.map(([key, weight]) => [
      `${key.slice(2)}s`,
      Math.trunc((weight / decades[0][1]) * 100)
    ]),
    countries: family("c:"),
    languages: family("l:"),
    runtime: runtime ? runtime[0].slice(2) : null
  };
}

/** ratingsA/B contain stored -2..2 ratings; three common ratings enable agreement. */
function compatibility(a, b, ratingsA = {}, ratingsB = {}) {
  const similarity =
    Object.keys(a.profile).length && Object.keys(b.profile).length
      ? cosine(a.profile, b.profile)
      : null;
  const common = Object.keys(ratingsA).filter((key) => has(ratingsB, key));
  const agreement =
    common.length >= 3
      ? 1 - sum(common.map((key) => Math.abs(ratingsA[key] - ratingsB[key]) / 4)) / common.length
      : null;
  const score =
    similarity != null && agreement != null
      ? 0.5 * similarity + 0.5 * agreement
      : (similarity ?? agreement);
  return score == null ? 0 : clamp(Math.trunc(score * 100), 0, 100);
}

/** Returns [TitleFeatures, percent] pairs, ordered by the lower of both predictions. */
function together(a, b, candidates, limit = 20) {
  return candidates
    .map((title) => {
      const pa = predict(a, title);
      const pb = predict(b, title);
      return pa == null || pb == null ? null : [title, Math.min(pa.percent, pb.percent)];
    })
    .filter(Boolean)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

export const TasteModels = Object.freeze({ build, predict, portrait, compatibility, together });
