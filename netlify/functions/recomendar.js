// Netlify Function: recebe o questionário e devolve indicações em JSON.
// Chave e URL vêm do AI Gateway da Netlify ou das variáveis ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL.
const MODELO = process.env.MODELO || "claude-sonnet-5-5";

const regras = `Você é um assistente de indicação de livros. Responda SOMENTE com JSON válido, sem texto fora do JSON, neste formato:
{"indicacoes":[{"titulo":"","autor":"","tipo":"","idioma":"","pt_br":"sim|nao|nao_verificado","justificativa":"","modo":"1|2|3","evidencia":{"tipo":"declarada|sem_fonte","influenciador":"","fonte_tipo":"","link":""}}],"aviso":""}
Regras:
- Respeite a quantidade pedida e os modos escolhidos (1 gosto pessoal; 2 autores próximos em tema ou estilo; 3 autores de referência).
- Modo 3: só vale influência declarada pelo PRÓPRIO autor (entrevista, vídeo, biografia, prefácio, livro, declaração pública). Use a busca na web. Preencha "influenciador" (quem influenciou o autor lido), "fonte_tipo" e "link" apenas com URL realmente encontrada na busca. Se não achar, use evidencia.tipo="sem_fonte" e link vazio.
- Modos 1 e 2: evidencia.tipo="sem_fonte".
- Nunca invente link, citação ou disponibilidade; se não souber se há tradução para PT-BR, use "nao_verificado".
- Não indique livros já citados como favoritos nem o que não agradou. Respeite idiomas e a preferência por traduzidos.
- A justificativa (1 a 2 frases, em português) deve ligar a indicação às respostas do usuário.`;

async function chamar(corpo, usarBusca) {
  const base = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const payload = { model: MODELO, max_tokens: 3000, system: regras, messages: [{ role: "user", content: corpo }] };
  if (usarBusca) payload.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
  const r = await fetch(base + "/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || "Erro " + r.status);
  return j;
}

exports.handler = async (event) => {
  const h = { "content-type": "application/json" };
  try {
    const dados = JSON.parse(event.body || "{}");
    const corpo = "Dados do usuário (JSON):\n" + JSON.stringify(dados);
    let j, buscaOk = true;
    const modo3 = (dados.modos || []).includes("3");
    try { j = await chamar(corpo, modo3); }
    catch (e) { if (!modo3) throw e; buscaOk = false; j = await chamar(corpo, false); }

    // Links realmente recuperados pela busca (antialucinação)
    const urls = new Set();
    for (const b of j.content || []) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const c of b.content) if (c.url) urls.add(c.url);
    const texto = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Resposta fora do formato esperado. Tente novamente.");
    const out = JSON.parse(m[0]);
    for (const i of out.indicacoes || []) {
      const ev = i.evidencia || (i.evidencia = { tipo: "sem_fonte" });
      if (ev.tipo === "declarada" && !urls.has(ev.link)) { ev.tipo = "sem_fonte"; ev.link = ""; }
    }
    if (!buscaOk) out.aviso = "A busca na web não estava disponível: todas as indicações estão sem fonte declarada.";
    return { statusCode: 200, headers: h, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ erro: e.message }) };
  }
};
