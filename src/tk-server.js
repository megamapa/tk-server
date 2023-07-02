/********************************************************/
/* TK-SERVER                                            */
/* Para executar use: node tk-server.js &               */
/********************************************************/
process.title = 'tk-server';
const Version = 'v1.0.0';

async function GetDate() {
	let offset = new Date(new Date().getTime()).getTimezoneOffset();
	return new Date(new Date().getTime() - (offset*60*1000)).toISOString().replace(/T/,' ').replace(/\..+/, '');
}

/****************************************************************************************************/
/* Classe Device																					*/
/****************************************************************************************************/
class Device {

	constructor(socket) {
		this.usocket=socket;
		this.did='';
		this.login=0;
		this.logout=0;
		this.bytin=0;
		this.bytout=0;
		this.msgin=0;
		this.msgout=0;
		this.err='';
		this.mpnum=[]; // Mobile phone number
		this.msnum=0; // Mensagem serial number

		this.iccid='';
		this.dte=0;
		this.lat=0;
		this.lng=0;
		this.spd=0;
		this.dir=0;
		this.alt=0;
		this.bat=0;
		this.sat=0;
		this.sig=0;
	}

	// Publish device data
	async PublishDevice(str) {
		// Verifica se a chave existe indicando que o cliente ainda esta conectado
		hub.exists('did:'+this.did, function (err, result) {
			if (result==1) {
				hub.publish('did:'+this.did,'{"did":"'+this.did+'",'+str+'}');
			};
		});
	}

	// Publish text in SAN terminal
	async PublishLog(str) {
		// Verifica se a chave existe indicando que o cliente ainda está conectado
		hub.exists('log:'+this.did, function (err, result) {
			if (result==0) {
				// Publish text
				GetDate().then(dte => {	hub.publish('san:monitor_update','<li><div class=datetime>'+dte+' : </div>'+str+'</li>'); });
			}
		});
	}

	async InitDevice(did) {
		let th=this;
		GetDate().then(dte => {
			// Update ID and login datetime
			th.did = did;
			th.login = dte;
			// Publish login
			th.PublishDevice('"datetime":"'+th.login+'","type":"login"').catch(err => console.error(err));
			// Publish login
			th.PublishLog('<div class=warning>Connected</div>');
			numdev++;
		});
	}

	async SendToDevice(buff){
		// Envia pelo socket
		this.usocket.write(buff);
		// Update counters
		this.bytout+=buff.length;
		this.msgout++;
		bytsout+=buff.length;
		msgsout++;
	}

	async IncomingDevice(data) {
		this.bytin += data.length;
		bytsin += data.length;
		let th = this;
		// Processa os dados do buffer
		while (data.length > 0) {
			if (data[0] === 91 && data[1] === 83) {
				let i = data.indexOf("]");
				if (i > 10) {
					// Extrai linha do data
					let ln = data.toString().slice(0, i);
					data = data.slice(i + 1);
					// Separa parâmetros
					let par = ln.split("*");
					// Testa se é a primeira mensagem
					if (this.id === '') {
						await this.InitDevice(par[1]);
						// Publica login
						this.PublishDevice('"act":"login","dte":"' + th.login + '"').catch(err => console.error(err));
						// Responde ao device
						this.SendToDevice('[SG*' + this.id + '*0002*TS]');
					}
					// Envia log
					this.PublishLog(ln + ']');

					// Atualiza contadores
					this.msgin++;
					msgsin++;

					// Separa parâmetros
					let fld = par[3].split(",");
					switch (fld[0]) {
						case 'UD':
						case 'UD2': this.dte = '20' + fld[1].slice(4, 6) + '-' + fld[1].slice(2, 4) + '-' + fld[1].slice(0, 2) + ' ' + fld[2].slice(0, 2) + ':' + fld[2].slice(2, 4) + ':' + fld[2].slice(4);
							this.lat = parseFloat(fld[4]); if (fld[5] == 'S') { this.lat = this.lat * -1; }
							this.lng = parseFloat(fld[6]); if (fld[7] == 'W') { this.lng = this.lng * -1; }
							this.spd = parseFloat(fld[8]);
							this.dir = parseInt(fld[9]);
							this.alt = parseInt(fld[10]);
							this.bat = parseInt(fld[13]);

							// Verifica se tem LBS
							let i = parseInt(fld[17]);
							let lbs = '';
							if (i > 0) {
								lbs = ',"lbs":[';
								while (i > 0) {
									// Adciona a virgula depois de cada registro 
									if (lbs.length > 10) { lbs += ','; }
									// Adciona o registro LBS a string json 
									lbs += '[' + fld[18 + (i * 3)] + ',' + fld[19 + (i * 3)] + ',' + fld[20 + (i * 3)] + ']';
									i--;
								}
								lbs += ']';
							}

							// Publica
							this.PublishDevice('"act":"data","gps":[{"dtm":"' + th.dte + '","pos":[' + th.lat + ',' + th.lng + ',' + th.alt + ',' + th.dir + ',' + th.spd + ']' + lbs + '}]').catch(err => console.error(err));

							// Formata LBS como JSON
							if (lbs.length > 0) { lbs = lbs.slice(1); lbs = '{' + lbs + '}' }

							// Grava localização GPS
							db.getConnection(function (err, connection) {
								if (!err) {
									connection.query('INSERT INTO devdta (did,dte,lat,lng,spd,dir,alt,bat,sat,sig,gsm,mcc,mnc,lbs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [th.id, th.dte, th.lat, th.lng, th.spd, th.dir, th.alt, th.bat, parseInt(fld[11]), fld[3], parseInt(fld[12]), fld[19], fld[20], lbs], function (err, result) { connection.release(); if (err) { err => console.error(err) } });
								}
							});
							break;

						case 'LK': this.SendToDevice('[SG*' + this.id + '*0002*LK]');
							break;

						case 'AL': this.SendToDevice('[SG*' + this.id + '*0002*AL]');
							break;

						case 'CCID': this.iccid = fld[1]; // Grava ccid
							db.getConnection(function (err, connection) {
								if (!err) {
									connection.query('INSERT INTO devicc (did,iccid) VALUES (?,?)', [th.id, th.iccid], function (err, result) { connection.release(); if (err) { err => console.error(err) } });
								}
							});
					}
				} else { return }
			} else
				if (data[0] === 42 && data[1] === 72) {
					let i = data.indexOf("#");
					if (i > 10) {
						// Extrai linha do data
						let ln = data.toString().slice(0, i);
						data = data.slice(i + 1);
						// Separa parâmetros
						let par = ln.split(",");
						// Testa se é a primeira mensagem 
						if (this.id === '') {
							await this.InitDevice(par[1]);
							// Publica login
							this.PublishDevice('"act":"login","dte":"' + th.login + '"').catch(err => console.error(err));
						}
						// Envia log
						this.PublishLog(ln + '#');

						// Responde ao device
						this.SendToDevice('*HQ,' + this.id + ',V4,V1,' + FormatDate() + '#');

						// Atualiza contadores
						this.msgin++;
						msgsin++;

						// Separa parâmetros
						let fld = ln.split(",");
						switch (fld[2]) {
							case 'V1': this.dte = '20' + fld[11].slice(4, 6) + '-' + fld[11].slice(2, 4) + '-' + fld[11].slice(0, 2) + ' ' + fld[3].slice(0, 2) + ':' + fld[3].slice(2, 4) + ':' + fld[3].slice(4);
								this.lat = parseInt(par[5].substr(0, 2)) + par[5].substr(2) / 60; if (par[6] == 'S') { this.lat = this.lat * -1; }
								this.lng = parseInt(par[7].substr(0, 2)) + par[7].substr(2) / 60; if (par[8] == 'W') { this.lng = this.lng * -1; }
								this.spd = parseFloat(fld[9]) * 1.852; // Converte de Knots para km/h
								this.dir = parseInt(fld[10]);
								// Calcula o percentual da bateria conforme tabela
								let bat = [10, 20, 40, 60, 80, 90, 100];
								this.bat = parseInt(fld[17]);
								if (this.bat > 0 && this.bat < 7) { this.bat = bat[this.bat]; } else { this.bat = 0; }

								// Grava localização
								db.getConnection(function (err, connection) {
									if (!err) {
										connection.query('INSERT INTO devdta (did,dte,lat,lng,spd,dir,alt,bat,sat,sig) VALUES (?,?,?,?,?,?,?,?,?,?)', [th.id, th.dte, th.lat, th.lng, th.spd, th.dir, th.alt, th.bat, th.sat, th.sig], function (err, result) { connection.release(); if (err) { err => console.error(err) } });
									}
								});

								// Publica
								this.PublishDevice('"act":"data","bat":"' + this.bat + '"');
								break;

							case 'NBR':
								break;

						}
					} else { return }

				} else
					// Se vier binario converte
					if (data[0] === 36 && data[1] === 89) {
						// Converte para ASCII
						if (data.length > 46) {
							// Extrai linha do data
							let ln = '';
							for (var i = 0; i < 47; i++) {
								var s = (data[i] * 1).toString(16);
								while (s.length < 2) { s = '0' + s; }
								ln += s;
							}
							data = data.slice(47);
							// Testa se é a primeira mensagem 
							if (this.id === '') {
								await this.InitDevice(ln.substring(2, 12));
								// Publica login
								this.PublishDevice('"act":"login","dte":"' + th.login + '"').catch(err => console.error(err));
							}
							// Envia log
							this.PublishLog(ln);

							// Atualiza contadores
							this.msgin++;
							msgsin++;

							// Atualiza variaveis
							this.dte = '20' + ln.substring(22, 24) + '-' + ln.substring(20, 22) + '-' + ln.substring(18, 20) + ' ' + ln.substring(12, 14) + ':' + ln.substring(14, 16) + ':' + ln.substring(16, 18)
							let w = parseInt(ln.substring(43, 44));
							this.lat = parseInt(ln.substring(24, 26)) + parseFloat(ln.substring(26, 28) + '.' + ln.substring(28, 32)) / 60; if ((w & 4) === 0) { this.lat = this.lat * -1; }
							this.lng = parseInt(ln.substring(34, 37)) + parseFloat(ln.substring(37, 39) + '.' + ln.substring(39, 43)) / 60; if ((w & 8) === 0) { this.lng = this.lng * -1; }
							this.spd = parseFloat(ln.substring(44, 47)) * 1.852; // Converte de Knots para km/h
							this.dir = parseInt(ln.substring(47, 50));
							// Calcula o percentual da bateria conforme tabela
							let bat = [0, 10, 20, 40, 60, 80, 100];
							this.bat = parseInt(ln.substring(32, 34));
							if (this.bat > 0 && this.bat < 7) { this.bat = bat[this.bat]; } else { this.bat = 0; }
							// Grava localização
							db.getConnection(function (err, connection) {
								if (!err) {
									connection.query('INSERT INTO devdta (did,dte,lat,lng,spd,dir,alt,bat,sat,sig) VALUES (?,?,?,?,?,?,?,?,?,?)', [th.id, th.dte, th.lat, th.lng, th.spd, th.dir, th.alt, th.bat, th.sat, th.sig], function (err, result) { connection.release(); if (err) { err => console.error(err) } });
								}
							});
							// Publica
							this.PublishDevice('"act":"data","bat":"' + this.bat + '"');
						} else { return }
					} else { data = data.slice(1); }
		}
	}

	async CloseDevice() {
		// Verifica se a conexão foi de um device valido
		if (this.did!=='') {
			let th=this;
			GetDate().then(dte => {
				// Get logout datetime
				th.logout = dte;
				// Grava log da conexão do device
				db.getConnection(function (err, connection) {
					if (!err) {
						connection.query('INSERT INTO devlog (did,login,logout,bytin,bytout,msgin,msgout) VALUES (?,?,?,?,?,?,?)', [th.did, th.login, th.logout, th.bytin, th.bytout, th.msgin, th.msgout], function (err, result) { connection.release(); if (err) { err => console.error(err); } });
					}
				});
				// Publish logout
				th.PublishDevice('"datetime":"'+th.logout+'","type":"logout","err":"'+th.err+'"').catch(err => console.error(err));
				// Publish log
				th.PublishLog('<div class=warning>Disconnected: '+th.err+'</div>');
				numdev--;
			});
		}	
	}
}

// Initialize new device connection
async function OpenDevice(socket) {
	const device=new Device(socket);
	
	socket.on('data',function(data){ device.IncomingDevice(data); });
	socket.on('close',async function(){ await device.CloseDevice(); delete device; });
	socket.on('end',function(){ device.err='0-Normal end'; device.usocket.destroy(); });
	socket.on('error',function(){ device.err = '1-Error'; device.usocket.destroy(); });
	// Close connection when inactive (5 min)
	socket.setTimeout(300000,function(){ device.err='2-Timeout'; device.usocket.destroy(); });
}

// Publish update status
async function UpdateSAN() {
	GetDate().then(dte => {
		let uptime = Date.parse(dte) - starttime;
		hub.publish('san:server_update','{"name":"'+process.title+'","version":"'+Version+'","ipport":"'+process.env.SrvIP+':'+process.env.SrvPort+'","uptime":"'+Math.floor(uptime/60000)+'"}');
	});
}

/****************************************************************************************************/
/* Read enviroment variables																		*/
/****************************************************************************************************/
const dotenv = require('dotenv');
dotenv.config();

/****************************************************************************************************/
/* Create and open Redis connection																	*/
/****************************************************************************************************/
const Redis = require('ioredis');
const hub = new Redis({host:process.env.RD_host, port:process.env.RD_port, password:process.env.RD_pass});
//const pub = new Redis({host:process.env.RD_host, port:process.env.RD_port, password:process.env.RD_pass});

// Updates server status as soon as it successfully connects
hub.on('connect', function () { GetDate().then(dte => { console.log('\033[36m'+dte+': \033[32mHUB connected.\033[0;0m');
														console.log('\033[36m'+dte+': \033[32mWaiting clients...\033[0;0m');}); 
													
													
														hub.set('log:9139003741','Teste');
														hub.set('log:9139003748','Carro');
														hub.set('log:9139003745','Megamapa');
													});

/****************************************************************************************************/
/* Create and open MySQL connection																	*/
/****************************************************************************************************/
const mysql = require('mysql');
const db = mysql.createPool({host:process.env.DB_host, database:process.env.DB_name, user:process.env.DB_user, password:process.env.DB_pass, connectionLimit:10});

// Initialize global variables
var starttime=0,numdev=0,msgsin=0,msgsout=0,bytsin=0,bytsout=0,bytserr=0;

// Update statistics ever 60s
setInterval(function() {
			// Publish update status
			UpdateSAN();
			// Get datetime
			GetDate().then(dte => {
				// Update database
				db.getConnection(function(err,connection){
					if (!err) {
						connection.query('INSERT INTO syslog (datlog,server,version,ipport,devices,msgsin,msgsout,bytsin,bytsout,bytserr) VALUES (?,?,?,?,?,?,?,?,?,?)',[dte, process.title, Version, process.env.SrvIP + ':' + process.env.SrvPort, numdev, msgsin, msgsout, bytsin, bytsout, bytserr],function (err, result) {connection.release(); if (err) err => console.error(err);});
					}
					msgsin=0;
					msgsout=0;
					bytsin=0;
					bytsout=0;
					bytserr=0;
				});
			});
},60000);

/****************************************************************************************************/
/* Create and open server connection																*/
/****************************************************************************************************/
const net = require('net');
const server = net.createServer(OpenDevice);
server.listen(process.env.SrvPort, process.env.SrvIP);

// Updates server status as soon as it successfully connects
server.on('listening', function () { UpdateSAN(); GetDate().then(dte => {
	console.log('\033[36m'+dte+': \033[32mServer connected.\033[0;0m');
	});
});

/****************************************************************************************************/
/* 	Show parameters and waiting clients																*/
/****************************************************************************************************/
const OS = require('os');
GetDate().then(dte => {
	// Save start datetime
	starttime = Date.parse(dte);
	// Show parameters and waiting clients
	console.log('\033[36m'+dte+': \033[37m================================');
	console.log('\033[36m'+dte+': \033[37mAPP : ' + process.title + ' ('+Version+')');
	console.log('\033[36m'+dte+': \033[37mIP/Port : ' + process.env.SrvIP + ':' + process.env.SrvPort);
	console.log('\033[36m'+dte+': \033[37mCPUs: '+ OS.cpus().length);
	console.log('\033[36m'+dte+': \033[37m================================\033[0;0m');});