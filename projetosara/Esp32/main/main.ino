/*
  =====================================================================
  Projeto: Cabeça d'Água - Monitoramento de Nível de Água
  Placa: ESP32
  Sensor: HC-SR04
  Display: OLED 0,96" I2C (SSD1306)

  Esta versão une:
   - a leitura com média de várias amostras + fator de calibração
   - todos os componentes já ligados no projeto: 2 LEDs, buzzer e OLED
   - Wi-Fi + envio dos dados pro backend do site
   - fail-safe — se o sensor falhar (zona cega), envia 100%
     (crítico) pro site em vez de ficar em silêncio
   - cálculo de nível PROPORCIONAL (0-100%)

  CONFIGURAÇÃO FÍSICA DA MAQUETE (atualizada após troca de sensor):
   - Sensor: HC-SR04 (trocado do AJ-SR04M/JSN-SR04T — mesmo protocolo
     de leitura, sem mudança na lógica de codigo; zona cega bem menor
     e feixe mais estreito que o sensor anterior)
   - Sensor fixado a 32 cm do fundo do pote (pote de 17 cm + 15 cm de
     folga acima da borda)
   - Nível normal (baseline): 5 cm de água
   - Alerta (LED): a partir de 7 cm de água -> distancia = 32-7 = 25 cm
   - Perigo (buzzer): a partir de 11 cm de água -> distancia = 32-11 = 21 cm
   - Escala 0-100% enviada ao site: 0% = pote vazio (32 cm),
     100% = limiar de perigo, 11 cm de agua (21 cm)

  LIGAÇÕES:
  - HC-SR04:
      VCC  -> positivo da protoboard (5V - o HC-SR04 exige 5V de verdade)
      GND  -> negativo da protoboard
      TRIG -> D4
      ECHO -> divisor de tensão (1k + 2k) -> D14   (o eco sai em 5V,
              o ESP32 nao e tolerante a 5V nos GPIOs)
  - Display OLED (I2C):
      VCC -> positivo da protoboard
      GND -> negativo da protoboard
      SCK -> D22 (SCL)
      SDA -> D21 (SDA)
  - LED 1 (status normal):
      Anodo  -> resistor 220R -> D25
      Catodo -> negativo da protoboard
  - LED 2 (status de alerta/perigo):
      Anodo  -> resistor 220R -> D23
      Catodo -> negativo da protoboard
  - Buzzer:
      (-) -> negativo da protoboard
      (+) -> D27

  BIBLIOTECAS NECESSÁRIAS (Library Manager da Arduino IDE):
      - Adafruit SSD1306
      - Adafruit GFX Library
      (Adafruit BusIO é instalada automaticamente como dependência)
      (WiFi.h e HTTPClient.h já vêm com o pacote da placa ESP32)
      (o HC-SR04 nao usa biblioteca propria - leitura via pulseIn)
  =====================================================================
*/

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ================== PINOS ==================
#define TRIG_PIN         4
#define ECHO_PIN         14
#define LED_NORMAL_PIN   25
#define LED_ALERTA_PIN   23
#define BUZZER_PIN       27

// ================== DISPLAY OLED ==================
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define OLED_ADDR     0x3C   // se nao inicializar, tente 0x3D
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ================== CALIBRACAO DA LEITURA (HC-SR04) ==================
const float FATOR_CALIBRACAO = 1.0f;
const float OFFSET_CORRECAO_SENSOR_CM = 0.0f;

// Numero de leituras usadas para calcular a media a cada medicao
const int NUM_LEITURAS = 5;

// Timeout do pulso do sensor (HC-SR04 alcanca ate ~400cm)
const unsigned long SENSOR_TIMEOUT_US = 25000;

// ================== CALIBRACAO DO NIVEL (0% - 100%) ==================
// Pote vazio -> distancia = altura do sensor ate o fundo = 32 cm
const float DIST_NIVEL_0_CM   = 30.0;

// "100%" = limiar de perigo definido (11 cm de agua) -> distancia = 30-11 = 19 cm
const float DIST_NIVEL_100_CM = 19.0;

// ================== LIMIARES DIRETOS EM CM (LED e BUZZER) ==================
// Definidos direto pela altura de agua combinada com a orientadora,
// nao mais derivados de uma porcentagem generica.
// A agua sobe -> a distancia sensor-agua DIMINUI, por isso o limiar do
// LED (mais longe) e MAIOR que o do buzzer (mais perto).
const float LIMIAR_LED_VERMELHO_CM = 23.0f;  // alerta a partir de 7 cm de agua (30-7=23)
const float LIMIAR_BUZZER_CM       = 19.0f;  // perigo a partir de 11 cm de agua (30-11=19)

// Intervalo entre medicoes completas
const unsigned long INTERVALO_LEITURA_MS = 2000;
unsigned long ultimaLeitura = 0;


// ================== WI-FI ==================
const char* WIFI_SSID     = "Felipe Moraes";
const char* WIFI_PASSWORD = "felipe123";

// ================== API DO SITE ==================
// IMPORTANTE: "localhost" NAO funciona aqui - o ESP32 e o PC sao
// dispositivos diferentes na rede. Use o IP local do PC com XAMPP
// (descubra rodando "ipconfig" no PC, no adaptador Wi-Fi, campo
// "Endereco IPv4").
const char* API_HOST = "10.182.206.24";
const int   API_PORT = 80;
const char* API_PATH = "/projetosara/backend/api/index.php?route=device/send-data";

const char* DEVICE_ID = "CDA-001";  // precisa bater com um device_code ja cadastrado no site

// Campos que o backend espera mas que ainda nao temos sensor real:
// valores fixos por enquanto, ajuste quando tiver os sensores.
const float TEMPERATURA_FIXA = 25.0;   // TODO: sem sensor de temperatura (ex: DS18B20) ainda
const int   BATERIA_FIXA     = 100;    // TODO: sem leitura de bateria ainda
const float LATITUDE_FIXA    = -23.185;
const float LONGITUDE_FIXA   = -46.876;


// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  Serial.println(F("[DEBUG] setup iniciado."));

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_NORMAL_PIN, OUTPUT);
  pinMode(LED_ALERTA_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(LED_NORMAL_PIN, LOW);
  digitalWrite(LED_ALERTA_PIN, LOW);
  noTone(BUZZER_PIN);

  Wire.begin(21, 22); // SDA, SCL

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println(F("Falha ao iniciar o display OLED. Verifique o endereco I2C (0x3C/0x3D) e as ligacoes."));
    while (true) { delay(10); }
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.display();

  conectarWiFi();

  Serial.println(F("Sistema Cabeca d'Agua iniciado."));
}


// =====================================================
// CONECTA AO WI-FI
// =====================================================
void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F("Wi-Fi ja conectado. IP do ESP32: "));
    Serial.println(WiFi.localIP());
    return;
  }

  Serial.print(F("[DEBUG] Wi-Fi status atual: "));
  Serial.println(WiFi.status());
  Serial.print(F("Conectando ao Wi-Fi"));
  WiFi.disconnect(false, false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) {
    delay(400);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print(F("Wi-Fi conectado! IP do ESP32: "));
    Serial.println(WiFi.localIP());
    Serial.print(F("RSSI do Wi-Fi: "));
    Serial.print(WiFi.RSSI());
    Serial.println(F(" dBm"));
    WiFi.setSleep(false);
  } else {
    Serial.print(F("[DEBUG] Wi-Fi nao conectou. Status final: "));
    Serial.println(WiFi.status());
    Serial.println();
    Serial.println(F("Nao foi possivel conectar ao Wi-Fi em 15s. Vou continuar tentando em segundo plano nas proximas leituras."));
  }
}


// =====================================================
// LEITURA DO SENSOR (uma amostra), com calibracao aplicada
// =====================================================
float medirUmaLeitura() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(5);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(20);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duracao = pulseIn(ECHO_PIN, HIGH, SENSOR_TIMEOUT_US);
  if (duracao == 0) return -1;

  float distancia = duracao * 0.0343f / 2.0f;
  distancia *= FATOR_CALIBRACAO;
  distancia += OFFSET_CORRECAO_SENSOR_CM;

  Serial.print(F("Raw echo us="));
  Serial.print(duracao);
  Serial.print(F(" | distancia_cm="));
  Serial.println(distancia, 2);

  if (distancia < 1 || distancia > 600) return -1;

  return distancia;
}


// =====================================================
// FAZ VARIAS LEITURAS E CALCULA A MEDIA (mais estavel)
// =====================================================
float medirDistanciaMedia() {
  float soma = 0;
  int leiturasValidas = 0;

  for (int i = 0; i < NUM_LEITURAS; i++) {
    float distancia = medirUmaLeitura();
    if (distancia > 0) {
      soma += distancia;
      leiturasValidas++;
    }
    delay(60);
  }

  if (leiturasValidas == 0) return -1;
  return soma / leiturasValidas;
}


// =====================================================
// CALCULO DO NIVEL EM PORCENTAGEM (proporcional)
// =====================================================
float calcularNivelPercentual(float distanciaCM) {
  float nivel = (DIST_NIVEL_0_CM - distanciaCM) / (DIST_NIVEL_0_CM - DIST_NIVEL_100_CM) * 100.0;
  if (nivel < 0)   nivel = 0;
  if (nivel > 100) nivel = 100;
  return nivel;
}


// =====================================================
// ATUALIZA O DISPLAY OLED
// =====================================================
void atualizarDisplay(float distanciaCM, float nivelPct, const char* status) {
  display.clearDisplay();

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(F("Cabeca d'Agua"));

  display.setCursor(0, 14);
  display.print(F("Distancia: "));
  display.print(distanciaCM, 1);
  display.println(F(" cm"));

  display.setCursor(0, 26);
  display.print(F("Nivel: "));
  display.print(nivelPct, 1);
  display.println(F(" %"));

  display.setCursor(0, 42);
  display.setTextSize(2);
  display.println(status);

  display.display();
}


// =====================================================
// CONTROLA LEDs E BUZZER CONFORME A DISTANCIA (CM)
// A agua sobe -> a distancia sensor-agua DIMINUI.
// =====================================================
void tratarAlertas(float distanciaCM) {
  bool leituraValida = (distanciaCM > 0);
  bool perigoBuzzer  = leituraValida && (distanciaCM <= LIMIAR_BUZZER_CM);
  bool alertaLed     = leituraValida && (distanciaCM <= LIMIAR_LED_VERMELHO_CM);

  if (perigoBuzzer) {
    // Perigo (>=11 cm de agua): LED vermelho + buzzer ligados
    digitalWrite(LED_NORMAL_PIN, LOW);
    digitalWrite(LED_ALERTA_PIN, HIGH);
    tone(BUZZER_PIN, 1000);

  } else if (alertaLed) {
    // Atencao (>=7 cm de agua, ainda abaixo do limiar de perigo): so o LED vermelho
    digitalWrite(LED_NORMAL_PIN, LOW);
    digitalWrite(LED_ALERTA_PIN, HIGH);
    noTone(BUZZER_PIN);

  } else {
    // Normal: agua ainda abaixo do limiar de alerta
    digitalWrite(LED_NORMAL_PIN, HIGH);
    digitalWrite(LED_ALERTA_PIN, LOW);
    noTone(BUZZER_PIN);
  }
}


// =====================================================
// ENVIA OS DADOS PRO SITE
// =====================================================
void enviarDados(float nivelPct, float distanciaCM, const char* status) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("Wi-Fi desconectado, nao foi possivel enviar os dados. Tentando reconectar..."));
    conectarWiFi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  Serial.print(F("[NET] ESP32 IP: "));
  Serial.println(WiFi.localIP());
  Serial.print(F("[NET] Testando TCP para "));
  Serial.print(API_HOST);
  Serial.print(':');
  Serial.println(API_PORT);

  WiFiClient tcpProbe;
  bool tcpConnected = tcpProbe.connect(API_HOST, API_PORT, 3000);
  Serial.println(tcpConnected ? F("[NET] TCP conectado") : F("[NET] TCP falhou"));
  tcpProbe.stop();
  if (!tcpConnected) return;

  WiFiClientSecure secureClient;
  secureClient.setInsecure();

  HTTPClient http;
  String url = String("https://") + API_HOST + API_PATH;
  Serial.print(F("API: "));
  Serial.println(url);
  http.begin(secureClient, url);
  http.setConnectTimeout(5000);
  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("ngrok-skip-browser-warning", "true");

  String payload = "{";
  payload += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  payload += "\"water_level\":" + String((int)round(nivelPct)) + ",";
  payload += "\"temperature\":" + String(TEMPERATURA_FIXA, 1) + ",";
  payload += "\"latitude\":" + String(LATITUDE_FIXA, 6) + ",";
  payload += "\"longitude\":" + String(LONGITUDE_FIXA, 6) + ",";
  payload += "\"battery\":" + String(BATERIA_FIXA) + ",";
  payload += "\"distance_cm\":" + String(distanciaCM, 2) + ",";
  payload += "\"status\":\"" + String(status) + "\"";
  payload += "}";

  Serial.println(F("[HTTP] Iniciando POST; aguarde ate 8 segundos."));
  int codigoResposta = http.POST(payload);
  Serial.print(F("[HTTP] POST retornou codigo: "));
  Serial.println(codigoResposta);

  if (codigoResposta > 0) {
    Serial.print(F("Dados enviados! Codigo HTTP: "));
    Serial.println(codigoResposta);
    Serial.print(F("Resposta da API: "));
    Serial.println(http.getString());
  } else {
    Serial.print(F("Falha ao enviar dados. Erro: "));
    Serial.println(http.errorToString(codigoResposta));
    Serial.print(F("Verifique se o PC responde em http://"));
    Serial.print(API_HOST);
    Serial.println(F(" e se o Apache esta liberado no firewall."));
  }

  http.end();
}


// =====================================================
// LOOP PRINCIPAL
// =====================================================
void loop() {
  if (millis() - ultimaLeitura >= INTERVALO_LEITURA_MS) {
    ultimaLeitura = millis();

    float distancia = medirDistanciaMedia();

    if (distancia < 0) {
      Serial.println(F("Erro na leitura do sensor (fora de alcance ou falha)."));
      atualizarDisplay(0, 0, "ERRO");

      // fail-safe: se nao consegue medir (ex: zona cega do sensor),
      // assume risco critico (100%) e avisa o site mesmo assim, em
      // vez de ficar em silencio numa falha de leitura.
      enviarDados(100.0, -1.0, "PERIGO");
      return;
    }

    float nivel = calcularNivelPercentual(distancia);

    const char* status;
    if (distancia <= LIMIAR_BUZZER_CM)             status = "PERIGO";
    else if (distancia <= LIMIAR_LED_VERMELHO_CM)  status = "ALERTA";
    else                                             status = "NORMAL";

    Serial.print(F("Distancia: "));
    Serial.print(distancia);
    Serial.print(F(" cm | Nivel: "));
    Serial.print(nivel);
    Serial.print(F(" % | Status: "));
    Serial.println(status);

    atualizarDisplay(distancia, nivel, status);
    tratarAlertas(distancia);
    // O backend usa distancia/status para aplicar os limiares reais do hardware.
    enviarDados(nivel, distancia, status);
  }
}
