// backend/server.js
require('dotenv').config(); // Carga las variables de entorno desde .env
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de la API-Football
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY; // Clave obtenida de .env
const RAPIDAPI_HOST = "api-football-v1.p.rapidapi.com";
const API_BASE_URL = `https://${RAPIDAPI_HOST}/v3`;

// Instancia de Axios configurada para la API-Football
const apiFootball = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST,
    },
});

// --- CONFIGURACIÓN DE LA CACHE EN MEMORIA ---
const cache = {}; // Objeto global para almacenar la cache

/**
 * Función genérica para manejar llamadas a la API-Football con cache.
 * @param {string} endpoint - El endpoint de la API-Football (ej: '/fixtures').
 * @param {object} params - Los parámetros de la solicitud.
 * @param {number} ttl - Tiempo de vida de la cache en milisegundos.
 * @returns {Promise<object>} La respuesta de la API-Football (desde cache o nueva).
 */
const cachedApiCall = async (endpoint, params, ttl = 3600 * 1000) => { // TTL por defecto: 1 hora
    const cacheKey = `${endpoint}-${JSON.stringify(params)}`; // Clave única para esta petición
    const now = Date.now();

    // Comprobar si los datos están en cache y no han expirado
    if (cache[cacheKey] && (now - cache[cacheKey].timestamp < cache[cacheKey].ttl)) {
        // console.log(`⚡️ Cache HIT: ${endpoint} - ${cacheKey.substring(0, 50)}...`); // Descomentar para depuración
        return cache[cacheKey].data;
    }

    // console.log(`🌍 Cache MISS: ${endpoint} - ${cacheKey.substring(0, 50)}... Fetching from API...`); // Descomentar para depuración

    const MAX_RETRIES = 3;
    let currentRetry = 0;
    while (currentRetry < MAX_RETRIES) {
        try {
            const response = await apiFootball.get(endpoint, { params });

            // Si la API devuelve un objeto 'errors' no vacío, lo tratamos como un error y no lo cacheamos
            if (response.data.errors && Object.keys(response.data.errors).length > 0) {
                const apiErrorMessage = Object.values(response.data.errors).join(', ');
                throw new Error(`API-Football Error: ${apiErrorMessage}`);
            }

            // Almacenar la respuesta exitosa en cache
            cache[cacheKey] = {
                data: response.data,
                timestamp: now,
                ttl: ttl,
            };
            return response.data;

        } catch (error) {
            if (axios.isAxiosError(error) && error.response && error.response.status === 429) {
                currentRetry++;
                const delayTime = Math.pow(2, currentRetry) * 1000 + Math.random() * 500; // Retraso exponencial con jitter
                console.warn(`⚠️ Rate limit exceeded (429) for ${endpoint}. Retrying in ${delayTime / 1000} seconds... (Attempt ${currentRetry}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, delayTime));
            } else {
                // Otro tipo de error, lanzar directamente
                console.error(`❌ Error en cachedApiCall para ${endpoint}:`, error.message);
                throw error;
            }
        }
    }
    throw new Error(`Failed to fetch from ${endpoint} after ${MAX_RETRIES} retries due to rate limits.`);
};

// ======================================================
// === MIDDLEWARE DE LA APLICACIÓN ===
// ======================================================

// PRIMERO: Middleware para parsear cuerpos JSON (¡ESENCIAL PARA req.body!)
app.use(express.json());
// SEGUNDO: Middleware CORS
app.use(cors());

// Middleware para depuración (opcional, puedes quitarlo después)
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.url} - Content-Type: ${req.headers['content-type']}`);
    next();
});

// ======================================================
// === FUNCIONES PARA OBTENER DATOS DE LA API-FOOTBALL ===
// ======================================================

/**
 * Obtiene partidos futuros de una liga y temporada (ahora con cache).
 * @param {number} leagueId - ID de la liga.
 * @param {number} season - Año de la temporada.
 * @param {number} next - Número de partidos futuros a obtener.
 * @returns {Promise<object>} Datos de partidos.
 */
const fetchFixtures = async (leagueId, season, next = 5) => {
    const fixturesTtl = 60 * 60 * 1000; // Cachear fixtures por 1 hora
    const responseData = await cachedApiCall('/fixtures', { league: leagueId, season: season, next: next, timezone: 'America/Mexico_City' }, fixturesTtl);

    if (responseData.errors && Object.keys(responseData.errors).length > 0) {
        const apiErrorMessage = Object.values(responseData.errors).join(', ');
        throw new Error(`API-Football Error: ${apiErrorMessage}`);
    }
    return responseData;
};

/**
 * Obtiene las temporadas disponibles para un equipo.
 * Endpoint: /teams/seasons
 * @param {number} teamId - ID del equipo.
 * @returns {Promise<number[]>} Array de años de temporada disponibles.
 */
const fetchTeamAvailableSeasons = async (teamId) => {
    try {
        const responseData = await cachedApiCall('/teams/seasons', { team: teamId }, 24 * 3600 * 1000); // Cachear por 24 horas
        if (responseData.response && Array.isArray(responseData.response)) {
            // Asegurarse de que son números y filtrarlos si hay nulos o inválidos
            return responseData.response.filter(s => typeof s === 'number' && !isNaN(s));
        }
        // console.warn(`⚠️ No se encontraron temporadas disponibles para el equipo ${teamId} o respuesta inesperada.`); // Descomentar para depuración
        return [];
    } catch (error) {
        console.error(`❌ Error al obtener temporadas para el equipo ${teamId}:`, error.message);
        return [];
    }
};

/**
 * Obtiene estadísticas detalladas de un equipo (ahora con cache).
 * @param {number} teamId - ID del equipo.
 * @param {number} leagueId - ID de la liga.
 * @param {number} season - Año de la temporada.
 * @returns {Promise<object>} Datos de estadísticas del equipo.
 */
const getTeamStatistics = async (teamId, leagueId, season) => {
    const statsTtl = 6 * 3600 * 1000; // Cachear estadísticas por 6 horas
    const responseData = await cachedApiCall('/teams/statistics', { team: teamId, league: leagueId, season: season }, statsTtl);

    // DEBUG: Log de la respuesta cruda de la API para estadísticas del equipo
    // const teamName = responseData.response?.team?.name || 'Unknown Team'; // Descomentar para depuración
    // const playedTotal = responseData.response?.fixtures?.played?.total || 0; // Descomentar para depuración
    // console.log(`DEBUG: Team Stats for ${teamName} (ID: ${teamId}), League ${leagueId}, Season ${season}: Played (Total): ${playedTotal}`); // Descomentar para depuración

    if (responseData.errors && Object.keys(responseData.errors).length > 0) {
        const apiErrorMessage = Object.values(responseData.errors).join(', ');
        throw new Error(`API-Football Error for /teams/statistics: ${apiErrorMessage}`);
    }

    if (responseData.response && Object.keys(responseData.response).length > 0) {
        return responseData.response;
    }
    
    throw new Error(`No statistics found for team ${teamId} in league ${leagueId} season ${season}. API response was empty or malformed.`);
};

/**
 * Obtiene la clasificación (standings) de una liga (ahora con cache).
 * @param {number} leagueId - ID de la liga.
 * @param {number} season - Año de la temporada.
 * @returns {Promise<object>} Datos de clasificación de la liga.
 */
const getStandings = async (leagueId, season) => {
    const standingsTtl = 6 * 3600 * 1000; // Cachear clasificaciones por 6 horas
    const responseData = await cachedApiCall('/standings', { league: leagueId, season: season }, standingsTtl);

    // DEBUG: Log de la respuesta cruda de la API para clasificación de la liga
    // const leagueName = responseData.response?.[0]?.league?.name || 'Unknown League'; // Descomentar para depuración
    // console.log(`DEBUG: Standings for ${leagueName} (ID: ${leagueId}), Season ${season}: Total Groups: ${responseData.response?.[0]?.league?.standings?.length || 0}`); // Descomentar para depuración

    if (responseData.errors && Object.keys(responseData.errors).length > 0) {
        const apiErrorMessage = Object.values(responseData.errors).join(', ');
        throw new Error(`API-Football Error for /standings: ${apiErrorMessage}`);
    }
    
    if (responseData.response && responseData.response.length > 0 && 
        responseData.response[0].league && responseData.response[0].league.standings && 
        responseData.response[0].league.standings.length > 0) {
        return responseData.response[0].league.standings; // Devuelve el array completo de grupos
    }
    throw new Error(`No standings found for league ${leagueId} season ${season}. API response was empty or malformed.`);
};

/**
 * Obtiene estadísticas Cara a Cara (Head-to-Head) entre dos equipos.
 * Endpoint: /fixtures/headtohead
 * @param {number} teamId1 - ID del primer equipo.
 * @param {number} teamId2 - ID del segundo equipo.
 * @returns {Promise<any[]>} Array de partidos H2H.
 */
const fetchHeadToHeadStats = async (teamId1, teamId2) => {
    try {
        const responseData = await cachedApiCall('/fixtures/headtohead', { h2h: `${teamId1}-${teamId2}` }, 12 * 3600 * 1000);
        if (responseData.response && Array.isArray(responseData.response)) {
            return responseData.response.filter(fixture => fixture.fixture?.status?.short === 'FT');
        }
        // console.warn(`⚠️ No se encontraron datos H2H para ${teamId1} vs ${teamId2} o respuesta inesperada.`); // Descomentar para depuración
        return [];
    } catch (error) {
        console.error(`❌ Error al obtener H2H para ${teamId1} vs ${teamId2}:`, error.message);
        return [];
    }
};

// ===========================================
// === FUNCIONES PARA EL MODELO DE PREDICIÓN ===
// === (AHORA CON H2H INTEGRADO) ===
// ===========================================

function factorial(n) { if (n === 0) return 1; let res = 1; for (let i = 2; i <= n; i++) res *= i; return res;}
function poissonPMF(k, lambda) { if (lambda < 0) return 0; return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);}
function parseForm(formString) { if (!formString) return { win: 0, draw: 0, lose: 0 }; const wins = (formString.match(/W/g) || []).length; const draws = (formString.match(/D/g) || []).length; const losses = (formString.match(/L/g) || []).length; return { win: wins, draw: draws, lose: losses };}

function parseH2HResults(fixtures, homeTeamId, awayTeamId) {
    let homeWins = 0; let awayWins = 0; let draws = 0; let totalGames = 0;
    const recentFixtures = fixtures.slice(0, 10); 
    for (const fixture of recentFixtures) {
        totalGames++;
        const homeScore = fixture.score?.fulltime?.home;
        const awayScore = fixture.score?.fulltime?.away;
        if (homeScore !== null && awayScore !== null) {
            const fixtureHomeTeamId = fixture.teams.home.id;
            const fixtureAwayTeamId = fixture.teams.away.id;
            if (fixtureHomeTeamId === homeTeamId && fixtureAwayTeamId === awayTeamId) {
                if (homeScore > awayScore) homeWins++;
                else if (awayScore > homeScore) awayWins++;
                else draws++;
            } else if (fixtureHomeTeamId === awayTeamId && fixtureAwayTeamId === homeTeamId) {
                if (homeScore > awayScore) awayWins++; 
                else if (awayScore > homeScore) homeWins++; 
                else draws++;
            }
        }
    }
    const homeWinPercentage = totalGames > 0 ? (homeWins / totalGames) : 0.5;
    const awayWinPercentage = totalGames > 0 ? (awayWins / totalGames) : 0.5;
    const drawPercentage = totalGames > 0 ? (draws / totalGames) : 0.0; 
    return { homeWins, awayWins, draws, totalGames, homeWinPercentage, awayWinPercentage, drawPercentage };
}


/**
 * Genera una predicción de partido utilizando un modelo simplificado basado en Poisson.
 * Obtiene estadísticas de temporadas anteriores si no están disponibles para la temporada actual.
 * @param {number} homeTeamId - ID del equipo local.
 * @param {number} awayTeamId - ID del equipo visitante.
 * @param {number} leagueId - ID de la liga del partido actual.
 * @param {number} season - Año de la temporada del partido actual.
 * @returns {Promise<object>} Objeto con las predicciones del partido.
 */
async function getMatchPrediction(homeTeamId, awayTeamId, leagueId, season) {
    let homeTeamStatsRes;
    let awayTeamStatsRes;
    let leagueStandingsRes;
    let statsSeasonUsed = season;

    // Declaración de variables para el ámbito (scope)
    let expectedGoalsHome;
    let expectedGoalsAway;
    let homeWinProb;
    let awayWinProb;
    let drawProb;
    let bttsProb;
    let over2_5Prob;

    const homeTeamAvailableSeasons = await fetchTeamAvailableSeasons(homeTeamId);
    const awayTeamAvailableSeasons = await fetchTeamAvailableSeasons(awayTeamId);
    const commonAvailableSeasons = homeTeamAvailableSeasons.filter(s => awayTeamAvailableSeasons.includes(s));

    let seasonsToTry = [];
    if (season >= 2015) { seasonsToTry.push(season); }
    for (let i = 1; i <= 10; i++) { const prevSeason = season - i; if (prevSeason >= 2015) { if (!seasonsToTry.includes(prevSeason)) { seasonsToTry.push(prevSeason); } } else { break; } }
    seasonsToTry.sort((a, b) => b - a); 

    let statsFetchedSuccessfully = false;
    if (seasonsToTry.length === 0) { throw new Error(`No se pudieron obtener estadísticas válidas para los equipos en el rango requerido (>=2015).`); }

    for (const s of seasonsToTry) {
        if (statsFetchedSuccessfully) { break; }
        if (s < 2015) { break; }
        try {
            homeTeamStatsRes = await getTeamStatistics(homeTeamId, leagueId, s);
            awayTeamStatsRes = await getTeamStatistics(awayTeamId, leagueId, s);
            leagueStandingsRes = await getStandings(leagueId, s); 

            const homePlayed = homeTeamStatsRes.fixtures?.played?.total || 0;
            const awayPlayed = awayTeamStatsRes.fixtures?.played?.total || 0;
            let standingsHasData = false;
            if (Array.isArray(leagueStandingsRes)) { for (const group of leagueStandingsRes) { if (Array.isArray(group)) { for (const teamStat of group) { if ((teamStat.all?.played || 0) > 0) { standingsHasData = true; break; } } } if (standingsHasData) break; } }

            if (homePlayed > 0 && awayPlayed > 0 && standingsHasData) {
                statsSeasonUsed = s;
                statsFetchedSuccessfully = true;
                break; 
            }
        } catch (error) { /* continue to next season */ }
    }

    if (!statsFetchedSuccessfully || !homeTeamStatsRes || !awayTeamStatsRes || !leagueStandingsRes) {
        throw new Error(`No se pudieron obtener estadísticas válidas para los equipos en ninguna de las temporadas disponibles o intentadas (${seasonsToTry.join(', ')}). Asegúrate de que los IDs de equipos y liga sean correctos y que la API tenga datos sustanciales para esas temporadas.`);
    }

    const homeTeamName = homeTeamStatsRes.team?.name || 'Equipo Local';
    const awayTeamName = awayTeamStatsRes.team?.name || 'Equipo Visitante';
    const homePlayedHome = homeTeamStatsRes.fixtures?.played?.home || 1;
    const homeGoalsForHome = homeTeamStatsRes.goals?.for?.total?.home || 0;
    const homeGoalsAgainstHome = homeTeamStatsRes.goals?.against?.total?.home || 0;
    const awayPlayedAway = awayTeamStatsRes.fixtures?.played?.away || 1;
    const awayGoalsForAway = awayTeamStatsRes.goals?.for?.total?.away || 0;
    const awayGoalsAgainstAway = awayTeamStatsRes.goals?.against?.total?.away || 0;

    let totalLeagueGoals = 0; let totalLeagueMatches = 0;
    if (Array.isArray(leagueStandingsRes)) { for (const group of leagueStandingsRes) { if (Array.isArray(group)) { for (const teamStat of group) { if (teamStat.all) { totalLeagueGoals += (teamStat.all.goals.for || 0) + (teamStat.all.goals.against || 0); totalLeagueMatches += (teamStat.all.played || 0); } } } } }
    else if (leagueStandingsRes && typeof leagueStandingsRes === 'object' && leagueStandingsRes.all) { totalLeagueGoals += (leagueStandingsRes.all.goals.for || 0) + (leagueStandingsRes.all.goals.against || 0); totalLeagueMatches += (leagueStandingsRes.all.played || 0); }

    const leagueAvgGoalsPerMatch = totalLeagueMatches > 0 ? totalLeagueGoals / totalLeagueMatches : 2.5;

    const homeAttackStrength = (homeGoalsForHome / (homePlayedHome || 1)) / (leagueAvgGoalsPerMatch || 1);
    const homeDefenseStrength = (homeGoalsAgainstHome / (homePlayedHome || 1)) / (leagueAvgGoalsPerMatch || 1);
    const awayAttackStrength = (awayGoalsForAway / (awayPlayedAway || 1)) / (leagueAvgGoalsPerMatch || 1);
    const awayDefenseStrength = (awayGoalsAgainstAway / (awayPlayedAway || 1)) / (leagueAvgGoalsPerMatch || 1);
    const HOME_ADVANTAGE_FACTOR = 1.2;

    expectedGoalsHome = homeAttackStrength * (1 / (awayDefenseStrength || 1)) * HOME_ADVANTAGE_FACTOR;
    expectedGoalsAway = awayAttackStrength * (1 / (homeDefenseStrength || 1));

    const h2hFixtures = await fetchHeadToHeadStats(homeTeamId, awayTeamId);
    const h2hParsed = parseH2HResults(h2hFixtures, homeTeamId, awayTeamId);

    const maxGoalsConsidered = 5;
    let initialHomeWinProb = 0; let initialAwayWinProb = 0; let initialDrawProb = 0; let initialBttsProb = 0; let initialOver2_5Prob = 0;
    for (let hg = 0; hg <= maxGoalsConsidered; hg++) {
        for (let ag = 0; ag <= maxGoalsConsidered; ag++) {
            const probHomeGoals = poissonPMF(hg, expectedGoalsHome); const probAwayGoals = poissonPMF(ag, expectedGoalsAway); const scoreProb = probHomeGoals * probAwayGoals;
            if (hg > ag) initialHomeWinProb += scoreProb; else if (ag > hg) initialAwayWinProb += scoreProb; else initialDrawProb += scoreProb;
            if (hg > 0 && ag > 0) initialBttsProb += scoreProb; if (hg + ag > 2.5) initialOver2_5Prob += scoreProb;
        }
    }
    const initialTotalResultProb = initialHomeWinProb + initialAwayWinProb + initialDrawProb;
    if (initialTotalResultProb > 0) { initialHomeWinProb /= initialTotalResultProb; initialAwayWinProb /= initialTotalResultProb; initialDrawProb /= initialTotalResultProb; } else { initialHomeWinProb = 0.33; initialAwayWinProb = 0.33; initialDrawProb = 0.34; }
    
    homeWinProb = initialHomeWinProb; awayWinProb = initialAwayWinProb; drawProb = initialDrawProb;
    bttsProb = initialBttsProb; over2_5Prob = initialOver2_5Prob;

    if (h2hParsed.totalGames >= 3) { 
        const H2H_WEIGHT = 0.4; 
        homeWinProb = (homeWinProb * (1 - H2H_WEIGHT)) + (h2hParsed.homeWinPercentage * H2H_WEIGHT);
        awayWinProb = (awayWinProb * (1 - H2H_WEIGHT)) + (h2hParsed.awayWinPercentage * H2H_WEIGHT);
        drawProb = (drawProb * (1 - H2H_WEIGHT)) + (h2hParsed.drawPercentage * H2H_WEIGHT);
        const sumCombinedProbs = homeWinProb + awayWinProb + drawProb;
        if (sumCombinedProbs > 0) { homeWinProb /= sumCombinedProbs; awayWinProb /= sumCombinedProbs; drawProb /= sumCombinedProbs; } else { homeWinProb = 0.33; awayWinProb = 0.33; drawProb = 0.34; }

        const originalTotalLambda = expectedGoalsHome + expectedGoalsAway; 
        const totalProbSum = homeWinProb + awayWinProb + drawProb; 
        const homeLambdaRatio = (homeWinProb + (drawProb / 2)) / (totalProbSum || 1);
        const awayLambdaRatio = (awayWinProb + (drawProb / 2)) / (totalProbSum || 1);
        expectedGoalsHome = originalTotalLambda * homeLambdaRatio;
        expectedGoalsAway = originalTotalLambda * awayLambdaRatio;
        expectedGoalsHome = Math.max(0.1, expectedGoalsHome); expectedGoalsAway = Math.max(0.1, expectedGoalsAway);
    }

    const maxGoalsConsideredFinal = 5;
    let finalBttsProb = 0; let finalOver2_5Prob = 0;
    for (let hg = 0; hg <= maxGoalsConsideredFinal; hg++) {
        for (let ag = 0; ag <= maxGoalsConsideredFinal; ag++) {
            const probHomeGoals = poissonPMF(hg, expectedGoalsHome); const probAwayGoals = poissonPMF(ag, expectedGoalsAway); const scoreProb = probHomeGoals * probAwayGoals;
            if (hg > 0 && ag > 0) finalBttsProb += scoreProb; if (hg + ag > 2.5) finalOver2_5Prob += scoreProb;
        }
    }
    bttsProb = finalBttsProb; over2_5Prob = finalOver2_5Prob;

    let predictedWinnerName = "Empate";
    let advice = `Predicción basada en nuestro modelo de IA/Bayes (estadísticas de la temporada ${statsSeasonUsed}).`;
    const maxResultProb = Math.max(homeWinProb, awayWinProb, drawProb);

    if (maxResultProb === homeWinProb) { predictedWinnerName = homeTeamName; advice = `${homeTeamName} es el favorito según el modelo (estadísticas de la temporada ${statsSeasonUsed}).`; }
    else if (maxResultProb === awayWinProb) { predictedWinnerName = awayTeamName; advice = `${awayTeamName} es el favorito según el modelo (estadísticas de la temporada ${statsSeasonUsed}).`; }
    else if (maxResultProb === drawProb) { predictedWinnerName = "Empate"; advice = `El modelo sugiere un partido muy parejo con alta probabilidad de empate (estadísticas de la temporada ${statsSeasonUsed}).`; }

    if (bttsProb > 0.5) { advice += " Se espera que ambos equipos anoten."; } else { advice += " Es probable que un equipo no anote o el partido termine 0-0."; }
    if (over2_5Prob > 0.5) { advice += " Se anticipan más de 2.5 goles en total."; } else { advice += " Se anticipan menos de 2.5 goles en total."; }

    const homeComparisonForm = homeTeamStatsRes.form ? parseForm(homeTeamStatsRes.form) : { win: 0, draw: 0, lose: 0 };
    const awayComparisonForm = awayTeamStatsRes.form ? parseForm(awayTeamStatsRes.form) : { win: 0, draw: 0, lose: 0 };
    const totalHomeFormGames = homeComparisonForm.win + homeComparisonForm.draw + homeComparisonForm.lose;
    const totalAwayFormGames = awayComparisonForm.win + awayComparisonForm.draw + awayComparisonForm.lose;

    let mostProbableScoreHome = 0; let mostProbableScoreAway = 0; let maxScoreProb = -1;
    for (let hg = 0; hg <= maxGoalsConsidered; hg++) {
        for (let ag = 0; ag <= maxGoalsConsidered; ag++) {
            const probHomeGoals = poissonPMF(hg, expectedGoalsHome);
            const probAwayGoals = poissonPMF(ag, expectedGoalsAway);
            const scoreProb = probHomeGoals * probAwayGoals;
            if (scoreProb > maxScoreProb) { maxScoreProb = scoreProb; mostProbableScoreHome = hg; mostProbableScoreAway = ag; }
        }
    }

    return {
        predictions: {
            advice: advice,
            winner: { name: predictedWinnerName },
            mostProbableScore: `${mostProbableScoreHome} - ${mostProbableScoreAway}`,
            btts: bttsProb > 0.5,
            under_over: over2_5Prob > 0.5 ? '+2.5' : '-2.5',
            goals: { home: expectedGoalsHome.toFixed(2), away: expectedGoalsAway.toFixed(2), },
            percent: { home: (homeWinProb * 100).toFixed(0) + '%', draw: (drawProb * 100).toFixed(0) + '%', away: (awayWinProb * 100).toFixed(0) + '%', },
            btts_probability: parseFloat((bttsProb * 100).toFixed(1)),
            over_2_5_probability: parseFloat((over2_5Prob * 100).toFixed(1)),
            under_2_5_probability: parseFloat(((1 - over2_5Prob) * 100).toFixed(1)),
        },
        comparison: {
            form: { home: totalHomeFormGames > 0 ? ((homeComparisonForm.win + homeComparisonForm.draw / 2) / totalHomeFormGames * 100).toFixed(0) + "%" : "50%", away: totalAwayFormGames > 0 ? ((awayComparisonForm.win + awayComparisonForm.draw / 2) / totalAwayFormGames * 100).toFixed(0) + "%" : "50%" },
            att: { home: ((expectedGoalsHome / (expectedGoalsHome + expectedGoalsAway || 1)) * 100).toFixed(0) + "%", away: ((expectedGoalsAway / (expectedGoalsHome + expectedGoalsAway || 1)) * 100).toFixed(0) + "%" },
            def: { home: ((expectedGoalsAway / (expectedGoalsHome + expectedGoalsAway || 1)) * 100).toFixed(0) + "%", away: ((expectedGoalsHome / (expectedGoalsHome + expectedGoalsAway || 1)) * 100).toFixed(0) + "%" },
            poisson_distribution: { home: (homeWinProb * 100).toFixed(0) + "%", away: (awayWinProb * 100).toFixed(0) + "%" },
            h2h: { home: (h2hParsed.homeWinPercentage * 100).toFixed(0) + "%", away: (h2hParsed.awayWinPercentage * 100).toFixed(0) + "%", draw: (h2hParsed.drawPercentage * 100).toFixed(0) + "%", totalGames: h2hParsed.totalGames },
            goals: { home: ((homeGoalsForHome / (homeGoalsForHome + awayGoalsForAway || 1)) * 100).toFixed(0) + "%", away: ((awayGoalsForAway / (homeGoalsForHome + awayGoalsForAway || 1)) * 100).toFixed(0) + "%" },
            total: { home: ((homeWinProb + (drawProb / 2)) * 100).toFixed(0) + "%", away: ((awayWinProb + (drawProb / 2)) * 100).toFixed(0) + "%" },
        },
    };
}

// --- ENDPOINTS DE LA API ---

// Endpoint para obtener partidos futuros
app.get('/api/all-fixtures', async (req, res) => {
    const league = parseInt(req.query.league || 39);
    const season = parseInt(req.query.season || 2025);
    const next = parseInt(req.query.next || 10);

    try {
        const data = await fetchFixtures(league, season, next);
        if (!data.response || data.response.length === 0) {
            return res.json({ response: [], message: "No se encontraron partidos para la liga/temporada especificada." });
        }
        res.json(data);
    } catch (error) {
        console.error("❌ Error en el endpoint /api/all-fixtures:", error.message);
        let details = error.message;
        try {
            const jsonStartIndex = error.message.indexOf('{');
            if (jsonStartIndex !== -1) {
                const jsonPart = error.message.substring(jsonStartIndex);
                const parsedError = JSON.parse(jsonPart);
                if (parsedError && typeof parsedError === 'object' && Object.keys(parsedError).length > 0) {
                    details = parsedError;
                }
            }
        } catch (e) {
            // Not a JSON error, use original message
        }
        res.status(500).json({ error: 'Fallo al obtener partidos', details: details });
    }
});

// Nuevo Endpoint para obtener predicciones personalizadas
app.post('/api/predict-match', async (req, res) => {
    const { homeTeamId, awayTeamId, leagueId, season } = req.body;

    if (!homeTeamId || !awayTeamId || !leagueId || !season) {
        return res.status(400).json({ error: 'Faltan parámetros requeridos: homeTeamId, awayTeamId, leagueId, season' });
    }

    try {
        const prediction = await getMatchPrediction(homeTeamId, awayTeamId, leagueId, season);
        res.json(prediction);
    } catch (error) {
        console.error('Error en /api/predict-match:', error.message);
        let details = error.message;
        if (axios.isAxiosError(error) && error.response) {
            details = error.response.data || error.message;
        }
        res.status(500).json({ error: 'Fallo al generar la predicción', details: details });
    }
});

// --- NUEVO ENDPOINT: PARLEY DEL DÍA ---
app.get('/api/parley-del-dia', async (req, res) => {
    const nextFixturesCount = 20; // Cuántos partidos futuros escanear por liga
    const allCandidateLegs = []; // Collect all potential parley legs

    // Define las ligas y temporadas que quieres escanear para el Parley del Día
    // Es CRÍTICO que estas combinaciones de liga/temporada tengan datos de estadísticas disponibles
    // Se priorizan ligas grandes y la temporada más reciente con datos completos
    const leaguesToScanForParley = [
        { league: 262, season: 2025, name: "Liga MX" },     // Para obtener próximos partidos de la temp. 2025/2026
  { league: 3, season: 2025, name: "UEFA Europa League" },      // Para obtener próximos partidos de la temp. 2025/2026
  { league: 848, season: 2025, name: "UEFA Europa Conference League" }, // Para obtener próximos partidos de la temp. 2025/2026
  { league: 253, season: 2025, name: "Major League Soccer" },   // Para obtener próximos partidos de la temp. 2025
  { league: 772, season: 2025, name: "Leagues Cup" }, 
  { league: 128, season: 2025, name: "Liga Profesional Argentina" },
  { league: 113, season: 2025, name: "Allsvenskan" },   
    ];

    // --- Lógica para escanear próximos 3 días si no se encuentran partidos hoy ---
    const today = new Date();
    const datesToScan = [
        today.toISOString().slice(0, 10), // Hoy
    ];
    // Añadir los próximos 2 días si es necesario
    for (let i = 1; i <= 2; i++) {
        const nextDay = new Date(today);
        nextDay.setDate(today.getDate() + i);
        datesToScan.push(nextDay.toISOString().slice(0, 10));
    }


    let foundEnoughLegs = false;
    const targetLegs = 2; // Queremos un parley de 2 partidos

    for (const date of datesToScan) {
        console.log(`🔍 Escaneando partidos para la fecha: ${date}...`);
        for (const leagueInfo of leaguesToScanForParley) {
            if (foundEnoughLegs) break; // Si ya encontramos suficientes, salimos
            try {
                // Modificar fetchFixtures para buscar por fecha específica y liga
                // La API-Football permite el parámetro 'date' para buscar fixtures en un día específico.
                const fixturesData = await cachedApiCall('/fixtures', { league: leagueInfo.id, season: leagueInfo.season, date: date, timezone: 'America/Mexico_City' }, 60 * 60 * 1000);
                
                if (fixturesData.response && fixturesData.response.length > 0) {
                    for (const fixture of fixturesData.response) {
                        if (foundEnoughLegs) break; // Si ya encontramos suficientes, salimos
                        // Solo considerar partidos que no hayan empezado y que tengan equipos válidos
                        if (fixture.fixture.status.short === 'NS' && fixture.teams.home.id && fixture.teams.away.id) {
                            try {
                                const predictionResult = await getMatchPrediction(
                                    fixture.teams.home.id,
                                    fixture.teams.away.id,
                                    fixture.league.id,
                                    fixture.league.season 
                                );

                                const homeProb = parseFloat(predictionResult.predictions.percent.home) / 100;
                                const awayProb = parseFloat(predictionResult.predictions.percent.away) / 100;
                                const drawProb = parseFloat(predictionResult.predictions.percent.draw) / 100;
                                const bttsProb = predictionResult.predictions.btts_probability / 100;
                                const over2_5Prob = predictionResult.predictions.over_2_5_probability / 100;
                                const under2_5Prob = predictionResult.predictions.under_2_5_probability / 100;

                                let bestPickDescription = null;
                                let pickConfidence = 0;
                                let pickType = '';
                                let simulatedIndividualOdd = 0;

                                // Criterios para seleccionar las "patas" del parley:
                                // Umbrales de confianza ligeramente más flexibles para aumentar la probabilidad de encontrar 2 partidos
                                // Prioridad 1: Ganador del partido con alta confianza (>= 60%) - Bajado de 65%
                                if (homeProb >= 0.60) {
                                    bestPickDescription = `${fixture.teams.home.name} gana el partido`;
                                    pickConfidence = homeProb;
                                    pickType = 'Ganador Local';
                                } else if (awayProb >= 0.60) {
                                    bestPickDescription = `${fixture.teams.away.name} gana el partido`;
                                    pickConfidence = awayProb;
                                    pickType = 'Ganador Visitante';
                                }
                                // Prioridad 2: Más de 2.5 Goles con alta confianza (>= 55%) - Bajado de 60%
                                else if (over2_5Prob >= 0.55) {
                                    bestPickDescription = 'Más de 2.5 Goles';
                                    pickConfidence = over2_5Prob;
                                    pickType = 'Total de Goles';
                                }
                                // Prioridad 3: Ambos Anotan SÍ con alta confianza (>= 55%) - Bajado de 60%
                                else if (bttsProb >= 0.55) { 
                                    bestPickDescription = 'Ambos Anotan: SÍ';
                                    pickConfidence = bttsProb;
                                    pickType = 'Ambos Anotan';
                                }
                                // Prioridad 4: Menos de 2.5 Goles con alta confianza (>= 55%) - Bajado de 60%
                                else if (under2_5Prob >= 0.55) {
                                    bestPickDescription = 'Menos de 2.5 Goles';
                                    pickConfidence = under2_5Prob;
                                    pickType = 'Total de Goles';
                                }

                                if (bestPickDescription && pickConfidence > 0) {
                                    simulatedIndividualOdd = (1 / pickConfidence);
                                    allCandidateLegs.push({
                                        match_id: fixture.fixture.id,
                                        home_team: fixture.teams.home.name,
                                        away_team: fixture.teams.away.name,
                                        home_logo: fixture.teams.home.logo,
                                        away_logo: fixture.teams.away.logo,
                                        home_team_id: fixture.teams.home.id, 
                                        away_team_id: fixture.teams.away.id, 
                                        competition_name: fixture.league.name,
                                        starting_at: fixture.fixture.date,
                                        pick_type: pickType,
                                        pick_description: bestPickDescription,
                                        confidence_percent: parseFloat((pickConfidence * 100).toFixed(1)),
                                        simulated_individual_odd: parseFloat(simulatedIndividualOdd.toFixed(2)),
                                        league_id: fixture.league.id,
                                        season_year: fixture.league.season,
                                    });
                                }
                            } catch (predictionError) {
                                // console.warn(`⚠️ Fallo al generar predicción para fixture ${fixture.fixture.id} (${fixture.teams.home.name} vs ${fixture.teams.away.name}): ${predictionError.message}`); // Descomentar para depuración
                            }
                        }
                    }
                }
            } catch (leagueError) {
                console.error(`❌ Error al escanear liga ${leagueInfo.name} para Parley en ${date}: ${leagueError.message}`);
            }
        }
        
        // Después de escanear todas las ligas para la fecha actual,
        // ordenamos y seleccionamos si ya tenemos suficientes.
        allCandidateLegs.sort((a, b) => {
            if (b.confidence_percent !== a.confidence_percent) {
                return b.confidence_percent - a.confidence_percent;
            }
            return b.simulated_individual_odd - a.simulated_individual_odd;
        });

        // Seleccionamos las mejores hasta ahora
        const currentSelectedLegs = [];
        const currentUsedMatchIds = new Set();
        for (const leg of allCandidateLegs) {
            if (currentSelectedLegs.length < targetLegs && !currentUsedMatchIds.has(leg.match_id)) {
                currentSelectedLegs.push(leg);
                currentUsedMatchIds.add(leg.match_id);
            }
        }

        if (currentSelectedLegs.length === targetLegs) {
            foundEnoughLegs = true; // Encontramos suficientes, podemos salir del bucle de fechas
            break; 
        }
    }

    const finalSelectedLegs = [];
    const finalUsedMatchIds = new Set();
    // Re-seleccionar de allCandidateLegs para asegurar que sean los 2 mejores de todo el escaneo
    for (const leg of allCandidateLegs) {
        if (finalSelectedLegs.length < targetLegs && !finalUsedMatchIds.has(leg.match_id)) {
            finalSelectedLegs.push(leg);
            finalUsedMatchIds.add(leg.match_id);
        }
    }


    if (finalSelectedLegs.length < targetLegs) {
        console.warn(`😔 No se pudieron encontrar suficientes selecciones de alta confianza (${targetLegs}) para el parley del día. Encontrados: ${finalSelectedLegs.length}`);
        return res.status(404).json({ message: "No se encontró un Parley del Día emocionante hoy con la confianza deseada. ¡Vuelve pronto!", found_legs: finalSelectedLegs.length, required_legs: targetLegs });
    }

    let totalSimulatedOdd = 1;
    let totalConfidencePercent = 1;
    finalSelectedLegs.forEach(leg => {
        totalSimulatedOdd *= leg.simulated_individual_odd;
        totalConfidencePercent *= (leg.confidence_percent / 100);
    });

    res.json({
        parley_id: `daily-parley-${new Date().toISOString().slice(0, 10)}`,
        title: `🏆 Doble de Confianza del Día - ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
        advice: "¡Esta es nuestra combinación más sólida de hoy, respaldada por nuestro modelo! Juega con estrategia.",
        legs: finalSelectedLegs,
        total_simulated_odd: parseFloat(totalSimulatedOdd.toFixed(2)),
        total_confidence_percent: parseFloat((totalConfidencePercent * 100).toFixed(1)),
    });

});

// ===================
// === INICIO DEL SERVIDOR ===
// ===================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor backend corriendo en http://0.0.0.0:${PORT}`);
    console.log(`🔑 Clave API cargada: ${RAPIDAPI_KEY ? 'Sí' : 'No (verifica .env)'}`);
    if (!RAPIDAPI_KEY) {
        console.warn('⚠️ ADVERTENCIA: La clave RAPIDAPI_KEY no está configurada. Las llamadas a la API-Football fallarán.');
    }
});