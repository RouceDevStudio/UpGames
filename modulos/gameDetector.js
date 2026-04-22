/**
 * SISTEMA DE DETECCIÓN AUTOMÁTICA DE JUEGOS — UpGames
 * Detecta cuando se publica contenido de un juego conocido
 * y guarda el link de compra oficial en extraData.detectedGame
 */

const GAMES_DATABASE = {

  // ── ROCKSTAR ────────────────────────────────────────────
  'GTA V': {
    name: 'Grand Theft Auto V', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/271590/Grand_Theft_Auto_V/',
    keywords: ['gta v','gta5','gta 5','grand theft auto v','grand theft auto 5','gtav']
  },
  'GTA San Andreas': {
    name: 'GTA San Andreas', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/12120/Grand_Theft_Auto_San_Andreas/',
    keywords: ['gta san andreas','san andreas','gtasa','gta sa']
  },
  'Red Dead Redemption 2': {
    name: 'Red Dead Redemption 2', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/1174180/Red_Dead_Redemption_2/',
    keywords: ['red dead redemption 2','rdr2','red dead 2']
  },

  // ── FROMSOFT ────────────────────────────────────────────
  'Dark Souls': {
    name: 'Dark Souls Remastered', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/570940/DARK_SOULS_REMASTERED/',
    keywords: ['dark souls','dark souls remastered','dark souls prepare to die','dark souls ptde','darksouls']
  },
  'Dark Souls II': {
    name: 'Dark Souls II', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/335300/DARK_SOULS_II_Scholar_of_the_First_Sin/',
    keywords: ['dark souls 2','dark souls ii','ds2']
  },
  'Dark Souls III': {
    name: 'Dark Souls III', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/374320/DARK_SOULS_III/',
    keywords: ['dark souls 3','dark souls iii','ds3']
  },
  'Elden Ring': {
    name: 'Elden Ring', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/1245620/ELDEN_RING/',
    keywords: ['elden ring','eldenring']
  },
  'Sekiro': {
    name: 'Sekiro: Shadows Die Twice', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/814380/Sekiro_Shadows_Die_Twice/',
    keywords: ['sekiro','shadows die twice']
  },
  'Bloodborne': {
    name: 'Bloodborne', platform: 'ps4',
    purchaseLink: 'https://store.playstation.com/en-us/product/UP9000-CUSA00900_00-BLOODBORNE0000EU',
    keywords: ['bloodborne']
  },

  // ── NEED FOR SPEED ──────────────────────────────────────
  'Need for Speed Most Wanted': {
    name: 'Need for Speed: Most Wanted (2005)', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/13520/Need_for_Speed_Most_Wanted/',
    keywords: ['need for speed most wanted','nfsmw','nfs most wanted','nfs mw','most wanted 2005','need for speed mw']
  },
  'Need for Speed Underground 2': {
    name: 'Need for Speed: Underground 2', platform: 'pc',
    purchaseLink: 'https://www.ea.com/games/need-for-speed/need-for-speed-underground-2',
    keywords: ['need for speed underground 2','nfsu2','nfs underground 2','underground 2']
  },
  'Need for Speed Heat': {
    name: 'Need for Speed Heat', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/1222680/Need_for_Speed_Heat/',
    keywords: ['need for speed heat','nfs heat']
  },
  'Need for Speed Unbound': {
    name: 'Need for Speed Unbound', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/1846380/Need_for_Speed_Unbound/',
    keywords: ['need for speed unbound','nfs unbound']
  },

  // ── SURVIVAL / SANDBOX ──────────────────────────────────
  'Minecraft': {
    name: 'Minecraft', platform: 'multi',
    purchaseLink: 'https://www.minecraft.net/en-us/store/minecraft-java-bedrock-edition-pc',
    keywords: ['minecraft']
  },
  'pixARK': {
    name: 'pixARK', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/593380/PixARK/',
    keywords: ['pixark','pix ark']
  },
  'ARK Survival Evolved': {
    name: 'ARK: Survival Evolved', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/346110/ARK_Survival_Evolved/',
    keywords: ['ark survival evolved','ark: survival','ark survival','ark evolved']
  },
  'ARK Survival Ascended': {
    name: 'ARK: Survival Ascended', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/2399830/ARK_Survival_Ascended/',
    keywords: ['ark survival ascended','ark ascended']
  },
  'Project Zomboid': {
    name: 'Project Zomboid', platform: 'pc',
    purchaseLink: 'https://store.steampowered.com/app/108600/Project_Zomboid/',
    keywords: ['project zomboid','zomboid','zomdroid','project zomdroid']
  },
  'Terraria': {
    name: 'Terraria', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/105600/Terraria/',
    keywords: ['terraria']
  },
  'Stardew Valley': {
    name: 'Stardew Valley', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/413150/Stardew_Valley/',
    keywords: ['stardew valley','stardew']
  },
  'Valheim': {
    name: 'Valheim', platform: 'pc',
    purchaseLink: 'https://store.steampowered.com/app/892970/Valheim/',
    keywords: ['valheim']
  },
  'Rust': {
    name: 'Rust', platform: 'pc',
    purchaseLink: 'https://store.steampowered.com/app/252490/Rust/',
    keywords: ['rust game','rust survival']
  },
  '7 Days to Die': {
    name: '7 Days to Die', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/251570/7_Days_to_Die/',
    keywords: ['7 days to die','7dtd']
  },

  // ── OPEN WORLD / RPG ────────────────────────────────────
  'Cyberpunk 2077': {
    name: 'Cyberpunk 2077', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/1091500/Cyberpunk_2077/',
    keywords: ['cyberpunk 2077','cyberpunk','cp2077']
  },
  'Skyrim': {
    name: 'The Elder Scrolls V: Skyrim', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/489830/The_Elder_Scrolls_V_Skyrim_Special_Edition/',
    keywords: ['skyrim','elder scrolls v','tes v','tesv']
  },
  'Witcher 3': {
    name: 'The Witcher 3: Wild Hunt', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/292030/The_Witcher_3_Wild_Hunt/',
    keywords: ['witcher 3','the witcher 3','witcher iii']
  },
  "Baldur's Gate 3": {
    name: "Baldur's Gate 3", platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/1086940/Baldurs_Gate_3/',
    keywords: ["baldur's gate 3","baldurs gate 3","bg3"]
  },
  'Hogwarts Legacy': {
    name: 'Hogwarts Legacy', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/990080/Hogwarts_Legacy/',
    keywords: ['hogwarts legacy','harry potter game']
  },
  'RDR2': {
    name: 'Red Dead Redemption 2', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/1174180/Red_Dead_Redemption_2/',
    keywords: ['red dead redemption','rdr']
  },

  // ── SHOOTERS ────────────────────────────────────────────
  'Fortnite': {
    name: 'Fortnite', platform: 'multi',
    purchaseLink: 'https://www.epicgames.com/fortnite/en-US/download',
    keywords: ['fortnite']
  },
  'PUBG': {
    name: 'PLAYERUNKNOWN\'S BATTLEGROUNDS', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/578080/PLAYERUNKNOWNS_BATTLEGROUNDS/',
    keywords: ['pubg','battlegrounds','playerunknown']
  },
  'Valorant': {
    name: 'Valorant', platform: 'pc',
    purchaseLink: 'https://playvalorant.com/en-us/download/',
    keywords: ['valorant']
  },
  'Counter-Strike': {
    name: 'Counter-Strike 2', platform: 'pc',
    purchaseLink: 'https://store.steampowered.com/app/730/CounterStrike_2/',
    keywords: ['counter-strike','cs2','csgo','cs:go','cs go']
  },
  'Call of Duty': {
    name: 'Call of Duty', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/2602690/Call_of_Duty/',
    keywords: ['call of duty','cod warzone','warzone','modern warfare','call of duty mw']
  },
  'Apex Legends': {
    name: 'Apex Legends', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/1172470/Apex_Legends/',
    keywords: ['apex legends','apex']
  },
  'Overwatch 2': {
    name: 'Overwatch 2', platform: 'multi',
    purchaseLink: 'https://playoverwatch.com/en-us/download/',
    keywords: ['overwatch 2','overwatch']
  },

  // ── MOBA / ONLINE ───────────────────────────────────────
  'League of Legends': {
    name: 'League of Legends', platform: 'pc',
    purchaseLink: 'https://signup.leagueoflegends.com/en-us/signup/index',
    keywords: ['league of legends','lol','league']
  },
  'Dota 2': {
    name: 'Dota 2', platform: 'pc',
    purchaseLink: 'https://store.steampowered.com/app/570/Dota_2/',
    keywords: ['dota 2','dota2']
  },

  // ── RACING / SPORTS ─────────────────────────────────────
  'Forza Horizon': {
    name: 'Forza Horizon 5', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/1551360/Forza_Horizon_5/',
    keywords: ['forza horizon','forza 5','forza horizon 5','fh5']
  },
  'EA Sports FC': {
    name: 'EA Sports FC 25', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/2195250/EA_SPORTS_FC_25/',
    keywords: ['ea sports fc','ea fc','fifa','fc 25','fc25']
  },
  'F1': {
    name: 'F1 24', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/2488620/F1_24/',
    keywords: ['f1 24','f1 game','formula 1 game']
  },

  // ── HORROR / INDIE ──────────────────────────────────────
  'Resident Evil': {
    name: 'Resident Evil', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/franchise/residentevil',
    keywords: ['resident evil','re village','resident evil village','re4','resident evil 4','re2','re3']
  },
  'Hollow Knight': {
    name: 'Hollow Knight', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/367520/Hollow_Knight/',
    keywords: ['hollow knight']
  },
  'Among Us': {
    name: 'Among Us', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/945360/Among_Us/',
    keywords: ['among us','among us game']
  },
  'Five Nights at Freddy': {
    name: "Five Nights at Freddy's", platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/319510/Five_Nights_at_Freddys/',
    keywords: ["five nights at freddy's",'fnaf','five nights at freddy']
  },

  // ── ANDROID / EMULACIÓN ─────────────────────────────────
  'PUBG Mobile': {
    name: 'PUBG Mobile', platform: 'mobile',
    purchaseLink: 'https://play.google.com/store/apps/details?id=com.tencent.ig',
    keywords: ['pubg mobile']
  },
  'COD Mobile': {
    name: 'Call of Duty: Mobile', platform: 'mobile',
    purchaseLink: 'https://play.google.com/store/apps/details?id=com.activision.callofduty.shooter',
    keywords: ['cod mobile','call of duty mobile','codm']
  },
  'Mobile Legends': {
    name: 'Mobile Legends: Bang Bang', platform: 'mobile',
    purchaseLink: 'https://play.google.com/store/apps/details?id=com.mobile.legends',
    keywords: ['mobile legends','mlbb']
  },
  'Free Fire': {
    name: 'Garena Free Fire', platform: 'mobile',
    purchaseLink: 'https://play.google.com/store/apps/details?id=com.dts.freefireth',
    keywords: ['free fire','freefire','garena free fire']
  },
  'Genshin Impact': {
    name: 'Genshin Impact', platform: 'multi',
    purchaseLink: 'https://genshin.hoyoverse.com/en/download',
    keywords: ['genshin impact','genshin']
  },

  // ── PLATAFORMEROS ───────────────────────────────────────
  'Hollow Knight Silksong': {
    name: 'Hollow Knight: Silksong', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/1030300/Hollow_Knight_Silksong/',
    keywords: ['silksong','hollow knight silksong']
  },
  'Celeste': {
    name: 'Celeste', platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/504230/Celeste/',
    keywords: ['celeste']
  },

  // ── SIMULADORES ─────────────────────────────────────────
  'BeamNG.drive': {
    name: 'BeamNG.drive', platform: 'pc',
    purchaseLink: 'https://store.steampowered.com/app/284160/BeamNGdrive/',
    keywords: ['beamng','beamng drive','beam ng']
  },
  'Euro Truck Simulator': {
    name: 'Euro Truck Simulator 2', platform: 'pc',
    purchaseLink: 'https://store.steampowered.com/app/227300/Euro_Truck_Simulator_2/',
    keywords: ['euro truck simulator','ets2','ets 2']
  }
};

function detectGame(title, description) {
  if(!title) return null;
  const text = (title + ' ' + (description||'')).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quita tildes

  for(const [key, data] of Object.entries(GAMES_DATABASE)) {
    for(const kw of data.keywords) {
      if(text.includes(kw)) {
        return {
          gameName:     data.name,
          gameKey:      key,
          platform:     data.platform,
          purchaseLink: data.purchaseLink
        };
      }
    }
  }
  return null;
}

function enrichGameData(doc) {
  const det = detectGame(doc.title, doc.description);
  if(det) {
    doc.extraData = doc.extraData || {};
    doc.extraData.detectedGame = {
      gameName:     det.gameName,
      gameKey:      det.gameKey,
      platform:     det.platform,
      purchaseLink: det.purchaseLink
    };
  }
  return doc;
}

module.exports = { detectGame, enrichGameData, GAMES_DATABASE };
