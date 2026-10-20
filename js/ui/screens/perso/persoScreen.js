import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { Recommendations } from "../../../core/perso/personalRecommendations.js";
import { Calendar } from "../../../core/perso/personalCalendar.js";
import { SharedLists } from "../../../core/perso/sharedLists.js";
import { WatchJournal, statistics } from "../../../core/perso/watchJournal.js";
import { TasteModels } from "../../../core/perso/recommendationEngine.js";
import {
  personalContext,
  isCurrentContext,
  safeArtwork
} from "../../../core/perso/personalContext.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { TitleRatings } from "../../../core/perso/titleRatings.js";
import { nextEpisodeSuggestions } from "./watchSuggestions.js";
import { showRatingDialog, showDiscovery } from "../../components/persoRatingOverlays.js";

const TABS = [
  ["recommendations", "Pour toi"],
  ["watch", "Que regarder ?"],
  ["taste", "Mes goûts"],
  ["calendar", "Calendrier"],
  ["stats", "Statistiques"],
  ["lists", "Listes partagées"]
];

/** "Aujourd'hui", "Demain" or the date, for a calendar day "YYYY-MM-DD" (nuv-087). */
function calendarDayLabel(date, nowMs = Date.now()) {
  const day = Date.parse(`${date}T00:00:00Z`);
  const now = new Date(nowMs);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((day - today) / 86_400_000);
  if (diff === 0) return `Aujourd'hui · ${date}`;
  if (diff === 1) return `Demain · ${date}`;
  return date;
}

export const MOODS = [
  ["Tout", []],
  ["Léger", ["comedy", "comédie", "animation", "family", "familial", "romance"]],
  ["Intense", ["action", "thriller", "crime", "war", "guerre", "adventure", "aventure"]],
  ["Frissons", ["horror", "horreur", "mystery", "mystère"]],
  ["Émotion", ["drama", "drame", "romance", "biography", "history", "histoire"]],
  [
    "Réflexion",
    ["science fiction", "sci-fi", "fantasy", "fantastique", "documentary", "documentaire"]
  ]
];
export function watchSuggestions(items, minutes, mood = 0) {
  return items
    .filter((t) => {
      const runtime = t.runtimeMinutes || (t.type === "movie" ? 110 : 45);
      return (
        runtime > 0 &&
        runtime <= minutes + Math.floor(minutes / 10) &&
        (!mood ||
          (t.genres || []).some((g) =>
            MOODS[mood][1].some((word) => g.toLowerCase().includes(word))
          ))
      );
    })
    .slice(0, 25);
}
const esc = (v = "") =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
const button = (key, label, selected = false, extra = "") =>
  `<button class="focusable perso-button${selected ? " selected" : ""}" data-key="${esc(key)}" ${extra}>${esc(label)}</button>`;
const empty = (title, description) =>
  `<div class="perso-empty"><h2>${esc(title)}</h2><p>${esc(description)}</p></div>`;
const hours = (ms) => `${Math.floor(ms / 3600000)} h ${Math.floor(ms / 60000) % 60} min`;
async function viewDeadline(work) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Personal view refresh pending")), 12000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const PersoScreen = {
  getRouteStateKey() {
    return `perso:${personalContext().scope}`;
  },
  captureRouteState() {
    return {
      ...this.state,
      focus: this.focusKey,
      scroll: this.scroller()?.scrollTop || 0,
      scope: this.ctx.scope
    };
  },
  scroller() {
    return this.container?.querySelector(".perso-content");
  },
  async mount(params = {}, navigation = {}) {
    this.ctx = personalContext();
    this.token = (this.token || 0) + 1;
    const saved =
      navigation.isBackNavigation && navigation.restoredState?.scope === this.ctx.scope
        ? navigation.restoredState
        : {};
    this.state = {
      tab: "recommendations",
      minutes: 45,
      mood: 0,
      period: "30",
      listPage: 0,
      calendarPage: 0,
      tastePeriod: "all",
      list: "",
      partner: "",
      ...saved
    };
    if (params.tab && TABS.some(([key]) => key === params.tab)) this.state.tab = params.tab;
    this.addCandidate = params.addCandidate || null;
    this.focusKey = saved.focus || `tab:${this.state.tab}`;
    this.error = "";
    this.loading = false;
    this.nextEpisodes = [];
    this.container = document.getElementById("perso");
    if (!this.container) {
      this.container = document.createElement("section");
      this.container.id = "perso";
      document.body.appendChild(this.container);
    }
    this.container.className = "perso-screen";
    ScreenUtils.show(this.container);
    this.onClick = (e) => {
      const node = e.target.closest("[data-key]");
      if (!node) return;
      if (node.tagName === "INPUT") this.focus(node.dataset.key);
      else void this.activate(node.dataset.key);
    };
    this.container.addEventListener("click", this.onClick);
    this.render();
    if (this.scroller()) this.scroller().scrollTop = saved.scroll || 0;
    void this.refresh();
  },
  async refresh(force = false) {
    const token = this.token,
      ctx = this.ctx;
    this.loading = true;
    this.error = "";
    this.updateStatus();
    const episodeJob = nextEpisodeSuggestions(ctx).then((items) => {
      if (token === this.token && isCurrentContext(ctx)) this.nextEpisodes = items;
    });
    const jobs = [
      TitleRatings.pull(ctx),
      WatchJournal.sync(ctx),
      SharedLists.sync(ctx),
      episodeJob
    ];
    const results = await Promise.allSettled(jobs.map(viewDeadline));
    if (token !== this.token || !isCurrentContext(ctx)) return;
    await Promise.allSettled([
      Recommendations.refresh({ ctx, force }),
      Calendar.refresh(ctx, { force })
    ]);
    if (token !== this.token || !isCurrentContext(ctx)) return;
    this.loading = false;
    if (
      results.some(
        (r) =>
          r.status === "rejected" ||
          (ctx.space.spaceCode && (r.value === false || r.value?.ok === false))
      ) ||
      Recommendations.status(ctx).error ||
      Calendar.status(ctx).error
    )
      this.error = "Synchronisation incomplète. Les données enregistrées restent disponibles.";
    this.render({ background: true });
  },
  updateStatus() {
    const node = this.container?.querySelector("[data-status]");
    if (node)
      node.textContent =
        this.error ||
        (this.loading
          ? "Actualisation en arrière-plan…"
          : this.ctx.space.spaceCode
            ? "Ton profil · synchronisation entre appareils"
            : "Sur cette télé · associe ton téléphone dans Réglages → Espace perso");
  },
  render({ background = false } = {}) {
    // Replacing an input while its TV keyboard is open can dismiss the keyboard.
    if (
      background &&
      this.container.contains(document.activeElement) &&
      document.activeElement?.tagName === "INPUT"
    ) {
      this.updateStatus();
      return;
    }
    const drafts = new Map(
      [...this.container.querySelectorAll("input[data-key]")].map((node) => [
        node.dataset.key,
        node.value
      ])
    );
    const scroll = this.scroller()?.scrollTop || 0;
    this.actions = new Map();
    const snapshot = Recommendations.snapshot(this.ctx);
    const titles = [...(snapshot.forYou || []), ...(snapshot.because || [])].filter(
      (t, i, a) => a.findIndex((x) => x.type === t.type && x.id === t.id) === i
    );
    let content = "";
    if (this.state.tab === "recommendations") {
      content = `<div class="perso-toolbar">${button("discovery", "Découverte · affiner mes goûts")}</div>`;
      content += this.cards(snapshot.forYou || [], "Pour toi");
      if (snapshot.because?.length)
        content += this.cards(
          snapshot.because,
          `Parce que tu as aimé ${snapshot.becauseTitle || "ces titres"}`
        );
    } else if (this.state.tab === "watch") {
      content = `<div class="perso-toolbar">${[20, 30, 45, 60, 90, 120, 180].map((n) => button(`time:${n}`, `${n} min`, n === this.state.minutes)).join("")}</div>
        <div class="perso-toolbar">${MOODS.map(([label], i) => button(`mood:${i}`, label, i === this.state.mood)).join("")}</div>`;
      content += this.cards(
        [
          ...this.nextEpisodes.filter(
            (t) => t.runtimeMinutes <= this.state.minutes + Math.floor(this.state.minutes / 10)
          ),
          ...watchSuggestions(titles, this.state.minutes, this.state.mood)
            .filter((t) => !this.nextEpisodes.some((ep) => ep.type === t.type && ep.id === t.id))
            .sort(
              (a, b) =>
                (Recommendations.predict(b, this.ctx)?.percent ?? 50) -
                (Recommendations.predict(a, this.ctx)?.percent ?? 50)
            )
        ],
        "Pour ton moment"
      );
    } else if (this.state.tab === "taste") {
      content = this.taste(snapshot, titles);
    } else if (this.state.tab === "calendar") {
      const cached = Calendar.read(this.ctx);
      const episodes = Array.isArray(cached) ? cached : cached?.episodes || [];
      content = `<p class="perso-help">Épisodes de ta bibliothèque et de tes séries en cours · 7 jours passés, 60 jours à venir</p>`;
      const days = new Map();
      const start = this.state.calendarPage * 40;
      content += `<div class="perso-toolbar">${start > 0 ? button("calendar-prev", "Précédents") : ""}${start + 40 < episodes.length ? button("calendar-next", "Suivants") : ""}</div>`;
      episodes.slice(start, start + 40).forEach((ep) => {
        const date = ep.releaseDate;
        if (!days.has(date)) days.set(date, []);
        days.get(date).push(ep);
      });
      for (const [date, items] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
        content += this.cards(
          items.map((ep) => ({
            type: ep.showType,
            id: ep.showId,
            name: ep.showTitle,
            poster: ep.poster,
            subtitle: `${ep.seasonNumber == null ? "" : `S${ep.seasonNumber} E${ep.episodeNumber}`} · ${ep.episodeTitle || "Nouvel épisode"}${ep.releaseTime ? ` · ${ep.releaseTime}` : ""}`
          })),
          calendarDayLabel(date)
        );
      }
      if (!episodes.length)
        content += empty(
          "Pas de sortie annoncée",
          "Ajoute des séries à ta bibliothèque. Les dates dépendent des métadonnées de tes addons."
        );
    } else if (this.state.tab === "stats") {
      const journal = WatchJournal.read(this.ctx);
      const report = statistics(journal.sessions, this.state.period, Date.now(), journal.facts);
      content = `<div class="perso-toolbar">${[
        ["7", "7 jours"],
        ["30", "30 jours"],
        ["year", "Cette année"],
        ["all", "Tout"]
      ]
        .map(([id, label]) => button(`period:${id}`, label, this.state.period === id))
        .join("")}</div>
        <div class="perso-metrics">${[
          [hours(report.totalWatchedMs), "Temps regardé"],
          [report.movieCount, "Films"],
          [report.episodeCount, "Épisodes"],
          [report.activeDays, "Jours actifs"]
        ]
          .map(
            ([v, label]) =>
              `<article><strong>${esc(v)}</strong><span>${esc(label)}</span></article>`
          )
          .join("")}</div>
        <p class="perso-help">${esc(report.devices.join(" · "))} · Les déplacements dans la vidéo ne comptent pas. ${report.estimatedShare ? `${Math.round(report.estimatedShare * 100)} % estimés.` : ""}</p>`;
      content += this.bars(
        report.genres.map(([label, ms]) => [
          label,
          Math.round((ms / Math.max(1, report.totalWatchedMs)) * 100)
        ]),
        "Tes genres sur cette période"
      );
      content += this.cards(
        report.top.map((t) => ({ ...t, subtitle: hours(t.watchedMs) })),
        "Les plus regardés"
      );
    } else content = this.lists();
    this.container.innerHTML = `<div class="perso-shell"><header class="perso-header"><div><p class="perso-eyebrow">${esc(this.ctx.name)}</p><h1>Mon espace</h1></div>
      <div class="perso-toolbar">${button("refresh", "Actualiser")}${button("back", "Retour")}</div></header>
      <div class="perso-layout"><nav aria-label="Mon espace">${TABS.map(([key, label]) => button(`tab:${key}`, label, this.state.tab === key)).join("")}</nav>
      <main class="perso-content" tabindex="-1"><p data-status role="status" class="perso-status"></p>${content}</main></div></div>`;
    for (const node of this.container.querySelectorAll("input[data-key]"))
      node.value = drafts.get(node.dataset.key) || "";
    this.scroller().scrollTop = scroll;
    this.updateStatus();
    this.focus(this.focusKey);
  },
  cards(items, heading) {
    if (!items.length)
      return `<h2>${esc(heading)}</h2>${empty("Encore un peu de découverte", "Note quelques titres ou ajoute-les à ta bibliothèque. Tes catalogues alimenteront les propositions.")}`;
    return `<h2>${esc(heading)}</h2><div class="perso-card-grid">${items
      .slice(0, 25)
      .map((t) => {
        const key = `title:${heading}:${t.type}:${t.id}:${t.subtitle || ""}`;
        this.actions.set(key, () => this.openTitle(t));
        const prediction = Recommendations.predict(t, this.ctx);
        return `<button class="focusable perso-title-card" data-key="${esc(key)}">
        ${safeArtwork(t.poster) ? `<img loading="lazy" decoding="async" src="${esc(t.poster)}" alt="" />` : `<span class="perso-poster-placeholder">N</span>`}
        <span><strong>${esc(t.name)}</strong><small>${esc(t.subtitle || [t.releaseInfo || t.year, t.runtimeMinutes ? `${t.runtimeMinutes} min` : "", prediction ? `Tu devrais aimer : ${prediction.percent} %` : ""].filter(Boolean).join(" · "))}</small></span></button>`;
      })
      .join("")}</div>`;
  },
  bars(values, heading) {
    if (!values?.length) return "";
    return `<section class="perso-portrait"><h2>${esc(heading)}</h2>${values.map(([label, score]) => `<div class="perso-bar"><span>${esc(label)}</span><div><i style="width:${Math.max(0, Math.min(100, Number(score) || 0))}%"></i></div><small>${Math.round(score)} %</small></div>`).join("")}</section>`;
  },
  taste(snapshot, titles) {
    const model = this.state.tastePeriod === "recent" ? snapshot.recentModel : snapshot.model;
    let html = `<div class="perso-toolbar">${button("taste:all", "Tous mes goûts", this.state.tastePeriod === "all")}${button("taste:recent", "En ce moment", this.state.tastePeriod === "recent")}${button("discovery", "Affiner avec Découverte")}</div>`;
    if (!model?.profile || !Object.keys(model.profile).length)
      return (
        html +
        empty(
          "Tes goûts se dessinent",
          "Les notes et le temps réellement regardé construisent ton portrait."
        )
      );
    const portrait = TasteModels.portrait(model);
    html += `<div class="perso-portrait-grid">${[
      ["genres", "Genres"],
      ["directors", "Réalisateurs"],
      ["cast", "Acteurs"],
      ["decades", "Décennies"],
      ["countries", "Pays"],
      ["languages", "Langues"]
    ]
      .map(([id, label]) => this.bars(portrait[id], label))
      .join("")}</div>`;
    const profiles = (LocalStore.get("profiles", []) || []).filter(
      (p) => String(p.id) !== this.ctx.id
    );
    if (profiles.length)
      html += `<h2>À regarder à deux</h2><div class="perso-toolbar">${profiles.map((p) => button(`partner:${p.id}`, p.name, this.state.partner === String(p.id))).join("")}</div>`;
    const p = profiles.find((p) => String(p.id) === this.state.partner);
    if (p) {
      const index = Number(p.profileIndex || p.profile_index || p.id) || 1;
      const peerCtx = {
        ...this.ctx,
        id: String(p.id),
        profileIndex: index,
        scope: this.ctx.scope.replace(/:\d+$/, `:${index}`)
      };
      const peer = Recommendations.snapshot(peerCtx);
      if (peer.model?.profile && Object.keys(peer.model.profile).length) {
        const ownRatings = Object.fromEntries(
          Object.entries(TitleRatings.all(this.ctx))
            .filter(([, s]) => s.value != null)
            .map(([key, s]) => [key, s.value])
        );
        const peerRatings = Object.fromEntries(
          Object.entries(TitleRatings.all(peerCtx))
            .filter(([, s]) => s.value != null)
            .map(([key, s]) => [key, s.value])
        );
        html += `<p class="perso-help">Compatibilité : ${TasteModels.compatibility(model, peer.model, ownRatings, peerRatings)} %</p>`;
        html += this.cards(
          TasteModels.together(model, peer.model, titles.map(Recommendations.featuresOf)).map(
            ([t, percent]) => ({ ...t, subtitle: `Pour vous deux : ${percent} %` })
          ),
          `Avec ${p.name}`
        );
      } else
        html += empty(
          "Portrait à compléter",
          "Ouvre Mon espace avec cet autre profil pour actualiser ses goûts sur la télé."
        );
    }
    return html;
  },
  lists() {
    const lists = SharedLists.all(this.ctx);
    const selected = lists[this.state.list];
    if (!selected) {
      let html = `<div class="perso-toolbar"><input data-key="list-name" aria-label="Nom de la nouvelle liste" placeholder="Nom de la liste" maxlength="80" />${button("create-list", "Créer")}
        <input data-key="list-code" aria-label="Code de la liste à rejoindre" placeholder="Code d’invitation" maxlength="16" />${button("join-list", "Rejoindre")}</div>`;
      if (this.addCandidate)
        html += `<p class="perso-help">Choisis une liste pour ajouter « ${esc(this.addCandidate.name)} ».</p>`;
      html += `<div class="perso-card-grid">${Object.values(lists)
        .map((list) =>
          button(
            `list:${list.code}`,
            `${list.name} · ${Object.values(list.items || {}).filter((i) => i.addedAt > i.removedAt).length} titres`
          )
        )
        .join("")}</div>`;
      if (!Object.keys(lists).length)
        html += empty(
          "À regarder ensemble",
          "Crée une liste ou rejoins celle du téléphone avec son code d’invitation."
        );
      return html;
    }
    const mine = SharedLists.myId(this.ctx);
    let html = `<div class="perso-toolbar">${button("lists-back", "Toutes les listes")}${button("share-list", "Partager le code")}</div><h2>${esc(selected.name)}</h2>${this.state.showCode ? `<p class="perso-help">Code d’invitation : <strong>${esc(selected.code)}</strong> · à saisir dans Listes partagées sur l’autre appareil.</p>` : ""}`;
    if (this.addCandidate) html += button("add-candidate", `Ajouter ${this.addCandidate.name}`);
    html += `<div class="perso-list-items">`;
    const items = Object.values(selected.items || {}).filter((i) => i.addedAt > i.removedAt);
    for (const item of items
      .sort((a, b) => SharedLists.consensus(b) - SharedLists.consensus(a))
      .slice(this.state.listPage * 40, (this.state.listPage + 1) * 40)) {
      const key = `${item.type}:${item.id}`;
      const open = `listtitle:${selected.code}:${key}`;
      this.actions.set(open, () => this.openTitle(item));
      const act = (name, label, value) => {
        const id = `listop:${selected.code}:${key}:${name}`;
        this.actions.set(id, async () => {
          if (!SharedLists.mutate(selected.code, key, name, value, this.ctx))
            throw new Error("List update rejected");
          this.render();
        });
        return button(id, label);
      };
      const rate = `listrate:${selected.code}:${key}`;
      this.actions.set(rate, () => {
        const ctx = this.ctx,
          token = this.token;
        showRatingDialog({
          ...item,
          onDone: (value) => {
            SharedLists.mutate(selected.code, key, "rating", value, ctx);
            if (token === this.token && isCurrentContext(ctx)) this.render();
          }
        });
      });
      html += `<article>${button(open, item.name)}<div class="perso-toolbar">
        ${act("like", item.likes?.[mine] > 0 ? "♥ Aimé" : "♡ J’aime", !(item.likes?.[mine] > 0))}
        ${act("watched", item.watchedAt > item.unwatchedAt ? "✓ Vu" : "Marquer vu", !(item.watchedAt > item.unwatchedAt))}
        ${button(rate, item.ratings?.[mine]?.v != null ? "Modifier ma note" : "Noter")}${act("remove", "Retirer", true)}</div></article>`;
    }
    return (
      html +
      `</div>` +
      (this.state.listPage > 0 ? button("list-prev", "Précédents") : "") +
      (items.length > (this.state.listPage + 1) * 40 ? button("list-next", "Suivants") : "") +
      (!items.length ? empty("Liste vide", "Ajoute des titres depuis leurs fiches.") : "")
    );
  },
  openTitle(t) {
    return Router.navigate("detail", {
      itemId: t.id,
      itemType: t.type || "movie",
      fallbackTitle: t.name,
      fallbackPoster: t.poster
    });
  },
  async activate(key) {
    if (!isCurrentContext(this.ctx)) return Router.navigate("perso");
    this.focusKey = key;
    if (this.actions.has(key)) {
      try {
        await this.actions.get(key)();
      } catch (_) {
        this.error = "Action non terminée. Réessaie après la synchronisation.";
        this.updateStatus();
      }
      return;
    }
    if (key === "back") return Router.back();
    if (key === "refresh") return this.refresh(true);
    if (key === "discovery") return showDiscovery({ openDetail: (t) => this.openTitle(t) });
    if (key.startsWith("tab:")) {
      this.state.tab = key.slice(4);
      this.state.list = "";
    }
    if (key.startsWith("time:")) this.state.minutes = Number(key.slice(5));
    if (key.startsWith("mood:")) this.state.mood = Number(key.slice(5));
    if (key.startsWith("period:")) this.state.period = key.slice(7);
    if (key.startsWith("taste:")) this.state.tastePeriod = key.slice(6);
    if (key.startsWith("partner:")) this.state.partner = key.slice(8);
    if (key.startsWith("list:")) {
      this.state.list = key.slice(5);
      this.state.showCode = false;
      this.state.listPage = 0;
    }
    if (key === "lists-back") this.state.list = "";
    if (key === "share-list") this.state.showCode = !this.state.showCode;
    if (key === "list-next") this.state.listPage++;
    if (key === "list-prev") this.state.listPage = Math.max(0, this.state.listPage - 1);
    if (key === "calendar-next") this.state.calendarPage++;
    if (key === "calendar-prev") this.state.calendarPage = Math.max(0, this.state.calendarPage - 1);
    try {
      if (key === "create-list") {
        const name = this.container.querySelector('[data-key="list-name"]').value.trim();
        if (!name) return;
        const list = await SharedLists.create(name, this.ctx);
        this.state.list = typeof list === "string" ? list : list.code;
      }
      if (key === "join-list") {
        const code = this.container.querySelector('[data-key="list-code"]').value.trim();
        const list = await SharedLists.join(code, this.ctx);
        this.state.list = typeof list === "string" ? list : list.code;
      }
      if (key === "add-candidate") {
        const t = this.addCandidate;
        await SharedLists.mutate(this.state.list, `${t.type}:${t.id}`, "add", t, this.ctx);
        this.addCandidate = null;
      }
    } catch (_) {
      this.error = "Vérifie le nom ou le code et la connexion, puis réessaie.";
      this.updateStatus();
      return;
    }
    this.render();
  },
  focus(key) {
    const nodes = [...this.container.querySelectorAll("[data-key]")];
    const node =
      nodes.find((n) => n.dataset.key === key) ||
      nodes.find((n) => n.dataset.key === `tab:${this.state.tab}`) ||
      nodes[0];
    this.container.querySelector(".focused")?.classList.remove("focused");
    if (!node) return;
    this.focusKey = node.dataset.key;
    node.classList.add("focused");
    node.focus({ preventScroll: true });
    const panel = this.scroller();
    if (panel?.contains(node)) {
      const rect = node.getBoundingClientRect(),
        bounds = panel.getBoundingClientRect();
      if (rect.top < bounds.top + 12) panel.scrollTop -= bounds.top + 12 - rect.top;
      else if (rect.bottom > bounds.bottom - 12)
        panel.scrollTop += rect.bottom - bounds.bottom + 12;
    }
  },
  onKeyDown(event) {
    const code = event.keyCode || event.which;
    const focused = this.container.querySelector(".focused");
    if (focused?.tagName === "INPUT" && code === 8) return;
    if ([8, 27, 461, 10009].includes(code)) {
      event.preventDefault();
      if (this.state.list) {
        this.state.list = "";
        this.render();
      } else Router.back();
      return;
    }
    if (focused?.tagName === "INPUT" && ![38, 40].includes(code)) return;
    if (code === 13) {
      event.preventDefault();
      void this.activate(this.focusKey);
      return;
    }
    if (![37, 38, 39, 40].includes(code) || !focused) return;
    event.preventDefault();
    const a = focused.getBoundingClientRect();
    const ax = (a.left + a.right) / 2,
      ay = (a.top + a.bottom) / 2;
    let target = null,
      distance = Infinity;
    for (const n of this.container.querySelectorAll("[data-key]")) {
      if (n === focused) continue;
      const b = n.getBoundingClientRect(),
        dx = (b.left + b.right) / 2 - ax,
        dy = (b.top + b.bottom) / 2 - ay;
      const forward = code === 37 ? -dx : code === 39 ? dx : code === 38 ? -dy : dy;
      if (forward < 1) continue;
      const cross = code === 37 || code === 39 ? Math.abs(dy) : Math.abs(dx);
      const score = forward + cross * 4;
      if (score < distance) {
        distance = score;
        target = n;
      }
    }
    if (target) this.focus(target.dataset.key);
  },
  cleanup() {
    this.token++;
    this.container?.removeEventListener("click", this.onClick);
    ScreenUtils.hide(this.container);
  }
};
