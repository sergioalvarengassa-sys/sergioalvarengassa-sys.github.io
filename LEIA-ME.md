# Contas CCS

Aplicativo instalável pelo navegador para Android e Windows. O pacote começa com uma base vazia. Ele pode ser usado offline e sincroniza alterações pelo Google Drive durante uma sessão Google ativa.

## Abrir no Windows para testar

1. Extraia o ZIP.
2. Execute `Abrir no Windows.cmd` ou rode `node preview.mjs` na pasta extraída. A prévia usa Node.js instalado na máquina e dispensa a instalação de dependências do projeto.
3. Abra `http://localhost:8765` no Chrome ou no Edge. Para instalar como aplicativo, use o botão de instalação do navegador.
4. Em **Dados e sincronização**, importe as suas planilhas. Selecione o ano de cada arquivo. As planilhas originais ficam na sua máquina.

Para usar o app em outro aparelho, publique o pacote em um endereço HTTPS e use esse mesmo endereço nos dois dispositivos. Os dados do teste em localhost ficam no navegador que o executou. Para migrar, use **Exportar dados** e **Restaurar cópia**.

## Preparar um link para outras pessoas

1. Publique somente o conteúdo deste pacote em um serviço estático gratuito, como [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) com repositório público. Se usar GitHub Pages, publique a pasta do app, com `index.html` na raiz da publicação.
2. No Google Cloud Console, crie um projeto com faturamento desativado, habilite a **Google Drive API** e configure o consentimento OAuth. Solicite somente `openid`, `email` e `https://www.googleapis.com/auth/drive.appdata`.
3. Crie um cliente OAuth do tipo **Aplicativo da Web**. Cadastre a origem HTTPS exata onde o app será servido, sem o caminho do repositório. Para um teste local separado, autorize `http://localhost:8765` no cliente de desenvolvimento.
4. Preencha `googleClientId` em `config.js` com o ID público do cliente e publique o arquivo. O app usa o ID público e mantém o token de acesso em memória durante a sessão. Guarde a administração do projeto e os segredos do cliente fora do pacote.
5. No modo de teste do Google, adicione as contas autorizadas. Antes de distribuir para o público, configure a publicação externa e conclua a verificação de marca se o Google exigir. A página `privacidade.html` é um ponto de partida para essa configuração. Revise os dados de contato da distribuição antes de publicar.
6. Envie às pessoas o link HTTPS. No Android, abra no Chrome e escolha **Instalar app** no menu. No Windows, abra no Chrome ou Edge e escolha a opção de instalação. Cada pessoa pode criar a própria base e conectar a própria conta Google.

As pessoas que recebem o link usam o mesmo cliente OAuth e têm dados separados em suas próprias contas Google. Quem hospeda uma cópia independente configura um novo cliente OAuth. A pasta privada do Drive é vinculada ao projeto OAuth, então a migração entre projetos independentes é feita por exportação e restauração.

A assinatura existente do Drive é suficiente para este desenho. A API tem cota gratuita. Mantenha o faturamento do projeto desativado e preserve as alterações localmente quando houver indisponibilidade ou limitação da API.

## Uso

- **Mensal** tem os valores recebidos nos dias 5 e 20, extras, edição dos gastos fixos e os saldos. O dia selecionado para uma conta ou fatura indica qual recebimento a financia.
- **Cartões** permite criar, editar, arquivar e reativar cartões. As faturas antigas e as parcelas agendadas continuam acessíveis.
- No relatório de um cartão, use **+ Lançamento**. Para parcelamento, informe o valor total, o mês da primeira fatura e o número de parcelas. O aplicativo divide os centavos sem alterar o valor total.
- A classificação **Assinatura** agrupa o lançamento na fatura. Lance cada cobrança no mês correspondente.
- A edição de um lançamento parcelado afeta a cobrança selecionada. As cobranças já importadas são preservadas por mês e número da parcela.
- **Dados e sincronização** reúne Drive, importação e cópias de segurança. A mesma conta Google deve ser usada nos dois aparelhos. Enquanto a sessão estiver ativa, o app sincroniza ao salvar, ao reabrir a janela e periodicamente com a janela em uso. Ao fechar o aplicativo ou quando o token expirar, reconecte a conta para retomar.
- Se o mesmo registro for editado em dois aparelhos antes de ambos sincronizarem, abra **Conflitos** e escolha a versão que deseja manter.

## Importação

O importador lê arquivos XLSX com o mesmo layout do Contas CCS, abas nomeadas de Jan a Dez, blocos de Pagamento e Vale nas colunas A/B e F/G e faturas nas colunas K/L e N/O. Ele usa os valores gravados no arquivo, incluindo resultados de fórmulas salvas pelo Excel. Salve a planilha após recalculá-la se tiver feito alterações.

Os arquivos originais são lidos no navegador. O importador considera apenas os intervalos financeiros do modelo e guarda os lançamentos, sem guardar o arquivo original. Verifique as categorias **Para revisar** e as linhas **Ajuste do total da planilha** depois de importar. Ajustes preservam os totais da fonte quando o subtotal gravado difere da soma dos lançamentos encontrados. Caso queira substituir uma importação alterada do mesmo ano, revise a base antes de importar novamente, pois um arquivo modificado pode gerar lançamentos adicionais.

As cópias JSON contêm dados financeiros. Guarde-as em local privado. Exporte uma cópia antes de limpar os dados do navegador ou trocar de projeto OAuth.

## Referências

- [PWA e instalação pelo navegador](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [Área privada do aplicativo no Google Drive](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Modelo de autorização Google para aplicativos web](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model)
- [Limites de uso da API Drive](https://developers.google.com/workspace/drive/api/guides/limits?hl=pt)

