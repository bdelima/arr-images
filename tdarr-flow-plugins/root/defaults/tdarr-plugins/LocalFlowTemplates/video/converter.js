'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Exported verbatim from the live Tdarr flow "264 to 265 Converter" (originally _id YEZ9GlGHp, now 20ZN6oc41) on 2026-11-08, then changed so that every remux step is the mkvmerge Execute plugin (mkvmergeExecute) instead of ffmpeg: the
// Remove video streams node is gone (audioSubs mode leaves video out) and Entry goes straight to the audio+subs step.
// Brought up to the live "Converter (0.6.0)" on 2026-11-10 (the build stamps the template's version onto the name, so the name here stays
// plain; the live flow is now called "Converter"). Changes from that update: the "Route to local CPU (demux path)" and "Mark step:
// landed on local (demux)" nodes are gone, so "Mark step: encode done" leads straight into the final mkvmerge combine; node positions moved.
// Brought up to the live "Converter (v11)" on 2026-11-11: after "Mark step: encode done" new "Route to mapped nodes" (Tags: Worker Type, CPU worker on a node tagged mapped) and
// "Mark step: landed on mapped node" (label converter-encode-mapped) come before the final mkvmerge combine, so an encode that ran on an unmapped node goes back to a mapped node,
// which downloads the encoded file from the server, before the combine reads the shared remux cache. "Route to encoder (GPU)" is renamed "Route to encoder nodes"; node positions moved.
// Quality tier, 2026-11-12: "Set Source-Relative Bitrate" (the QVBR cap) is replaced by "Set Quality With Node Offset", which adds the encode node's offset to the baseline quality (the Flow Variable
// tdarrQuality from the Controller's "Set Encode Quality", else the number Set Video Encoder wrote) and still records the source average and peak bitrate for the output tags. No bitrate cap is set.
// The template ships drakebay-gpu=-3: on one 1080p50 source, drakebay ICQ 28 gave 4478 kbps and ojochal ICQ 31 gave 4389 kbps, at near-equal VMAF.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
// Synced to Bob's live "Encoder (v13)" on 2026-11-15; the flow is now named Encoder (it was Converter). The single encode path is split by frame rate (Check Video Framerate, less than 31 fps): under 30 fps it goes to nodes tagged encoder and a Check Node Hardware Encoder (hevc_vaapi) picks the VAAPI encoder (quality 20) or the QSV encoder (quality 18); above 30 fps it goes to nodes tagged encoder,high-fps and the VAAPI encoder (quality 29). Each path has its own Set Quality Node Offset (drakebay-gpu=0, samara-encoder=-2 under 30 fps and -6 above). Keep Awake nodes stop and allow Windows sleep around the encode, "Route to mapped nodes" is now "Route to local node" (mapped,local), and the nodes were laid out again.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "20ZN6oc41",
    "name": "Encoder",
    "description": "Encoder",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Mark step: landed on local node",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "converter-encode-mapped"
        },
        "fpEnabled": true,
        "id": "qwYEerynw",
        "position": {
          "x": 432,
          "y": 468
        }
      },
      {
        "name": "Entry from Controller Flow",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "X4ANCc9vI",
        "position": {
          "x": 432,
          "y": -24
        }
      },
      {
        "name": "mkvmerge (audio+subs only)",
        "sourceRepo": "Local",
        "pluginName": "mkvmergeExecute",
        "version": "1.0.0",
        "inputsDB": {
          "mode": "audioSubs",
          "source": "working"
        },
        "fpEnabled": true,
        "id": "JTeKdNnFR",
        "position": {
          "x": 432,
          "y": 12
        }
      },
      {
        "name": "Preserve audio+subs (stable path)",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "userCli": "mkvmerge",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "true",
          "userOutputFilePath": "/temp/.tdarr-remux-cache/{{{args.originalLibraryFile.fileNameWithoutExtension}}}-audiosubs.mkv",
          "cliArguments": "-c mkdir -p \"/temp/.tdarr-remux-cache\"; cp \"{{{args.inputFileObj._id}}}\" \"${outputFilePath}\"",
          "outputFileBecomesWorkingFile": "false"
        },
        "fpEnabled": true,
        "id": "IBXuDL7Dx",
        "position": {
          "x": 432,
          "y": 60
        }
      },
      {
        "name": "mkvmerge (video from original)",
        "sourceRepo": "Local",
        "pluginName": "mkvmergeExecute",
        "version": "1.0.0",
        "inputsDB": {
          "mode": "video",
          "source": "original"
        },
        "fpEnabled": true,
        "id": "tpYlSXpfK",
        "position": {
          "x": 432,
          "y": 108
        }
      },
      {
        "name": "Route to >30fps encoder nodes",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "encoder,high-fps"
        },
        "fpEnabled": true,
        "id": "tHF4vUCsM",
        "position": {
          "x": 672,
          "y": 12
        }
      },
      {
        "name": "Begin Command (encode)",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandStart",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "ehGAkWvj7",
        "position": {
          "x": 756,
          "y": 168
        }
      },
      {
        "name": "<30fps VAAPI Encoder",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandSetVideoEncoder",
        "version": "1.0.0",
        "inputsDB": {
          "outputCodec": "hevc",
          "ffmpegPresetEnabled": "true",
          "ffmpegPreset": "slow",
          "ffmpegQualityEnabled": "true",
          "ffmpegQuality": "20",
          "hardwareEncoding": "true",
          "hardwareType": "vaapi",
          "hardwareDecoding": "true",
          "forceEncoding": "true"
        },
        "fpEnabled": true,
        "id": "FAc9QeWJK",
        "position": {
          "x": 828,
          "y": 312
        }
      },
      {
        "name": "Set Quality Node Offset (<30fps)",
        "sourceRepo": "Local",
        "pluginName": "setQualityWithNodeOffset",
        "version": "1.0.0",
        "inputsDB": {
          "nodeOffsets": "drakebay-gpu=0\nsamara-encoder=-2",
          "peakWindowSeconds": "2",
          "peakPercentile": "100",
          "peakScanTimeoutSeconds": "300",
          "assumedAudioKbps": "256"
        },
        "fpEnabled": true,
        "id": "qualOffset",
        "position": {
          "x": 912,
          "y": 396
        }
      },
      {
        "name": "Tag Encode Settings",
        "sourceRepo": "Local",
        "pluginName": "tagEncodeSettings",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "d7QK1TBlh",
        "position": {
          "x": 672,
          "y": 480
        }
      },
      {
        "name": "Execute (encode)",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandExecute",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "Y40uvSwMF",
        "position": {
          "x": 672,
          "y": 516
        }
      },
      {
        "name": "mkvmerge (final combine)",
        "sourceRepo": "Local",
        "pluginName": "mkvmergeExecute",
        "version": "1.0.0",
        "inputsDB": {
          "mode": "combine",
          "audioSubsDir": "/temp/.tdarr-remux-cache"
        },
        "fpEnabled": true,
        "id": "SQedUStPK",
        "position": {
          "x": 432,
          "y": 516
        }
      },
      {
        "name": "Cleanup audio+subs cache file",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "userCli": "mkvmerge",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "false",
          "cliArguments": "-c rm -f \"/temp/.tdarr-remux-cache/{{{args.originalLibraryFile.fileNameWithoutExtension}}}-audiosubs.mkv\"",
          "outputFileBecomesWorkingFile": "false"
        },
        "fpEnabled": true,
        "id": "R0CsTy4Qw",
        "position": {
          "x": 432,
          "y": 552
        }
      },
      {
        "name": "🛫 Returning to Controller Flow",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "HWxfel7zZ",
          "pluginId": "retFromConv"
        },
        "fpEnabled": true,
        "id": "b8n51xYj4",
        "position": {
          "x": 432,
          "y": 600
        }
      },
      {
        "name": "Mark step: landed on standard fps encoder",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "converter-encode-start"
        },
        "fpEnabled": true,
        "id": "cnvMarkEnc",
        "position": {
          "x": 408,
          "y": 276
        }
      },
      {
        "name": "Mark step: encode done",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "converter-encode-done"
        },
        "fpEnabled": true,
        "id": "cnvMarkEncDone",
        "position": {
          "x": 672,
          "y": 564
        }
      },
      {
        "name": "Route to local node",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredNodeTags": "mapped,local",
          "requiredWorkerType": "CPU"
        },
        "fpEnabled": true,
        "id": "qyqzR1Ocm",
        "position": {
          "x": 432,
          "y": 432
        }
      },
      {
        "name": "<30fps QSV Encoder",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandSetVideoEncoder",
        "version": "1.0.0",
        "inputsDB": {
          "outputCodec": "hevc",
          "ffmpegPresetEnabled": "true",
          "ffmpegPreset": "slow",
          "ffmpegQualityEnabled": "true",
          "ffmpegQuality": "18",
          "hardwareEncoding": "true",
          "hardwareType": "qsv",
          "hardwareDecoding": "true",
          "forceEncoding": "true"
        },
        "fpEnabled": true,
        "id": "8V9_07K-F",
        "position": {
          "x": 996,
          "y": 312
        }
      },
      {
        "name": "Mark step: landed on high fps encoder",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "converter-encode-start"
        },
        "fpEnabled": true,
        "id": "7D1MRCH2-",
        "position": {
          "x": 672,
          "y": 60
        }
      },
      {
        "name": "Set >30fps Video Encoder",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandSetVideoEncoder",
        "version": "1.0.0",
        "inputsDB": {
          "outputCodec": "hevc",
          "ffmpegPresetEnabled": "true",
          "ffmpegPreset": "slow",
          "ffmpegQualityEnabled": "true",
          "ffmpegQuality": "29",
          "hardwareEncoding": "true",
          "hardwareType": "vaapi",
          "hardwareDecoding": "true",
          "forceEncoding": "true"
        },
        "fpEnabled": true,
        "id": "Rn3WUT-NN",
        "position": {
          "x": 1176,
          "y": 312
        }
      },
      {
        "name": "Route to <30fps encoder nodes",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "encoder"
        },
        "fpEnabled": true,
        "id": "-RGSfdo8K",
        "position": {
          "x": 408,
          "y": 228
        }
      },
      {
        "name": "Set Quality Node Offset (>30fps)",
        "sourceRepo": "Local",
        "pluginName": "setQualityWithNodeOffset",
        "version": "1.0.0",
        "inputsDB": {
          "nodeOffsets": "drakebay-gpu=0\nsamara-encoder=-6",
          "peakWindowSeconds": "2",
          "peakPercentile": "100",
          "peakScanTimeoutSeconds": "300",
          "assumedAudioKbps": "256"
        },
        "fpEnabled": true,
        "id": "N2YufVfRT",
        "position": {
          "x": 1176,
          "y": 396
        }
      },
      {
        "name": "Check Video Framerate",
        "sourceRepo": "Community",
        "pluginName": "CheckVideoFramerate",
        "version": "1.0.0",
        "id": "EuW3bnW-x",
        "position": {
          "x": 984,
          "y": 120
        },
        "fpEnabled": true,
        "inputsDB": {
          "lessThan": "31"
        }
      },
      {
        "name": "Check Video Framerate",
        "sourceRepo": "Community",
        "pluginName": "CheckVideoFramerate",
        "version": "1.0.0",
        "id": "YbKi7dgS7",
        "position": {
          "x": 432,
          "y": 168
        },
        "fpEnabled": true,
        "inputsDB": {
          "greaterThan": "0",
          "lessThan": "31"
        }
      },
      {
        "name": "Check Node Hardware Encoder VAAPI",
        "sourceRepo": "Community",
        "pluginName": "checkNodeHardwareEncoder",
        "version": "1.0.0",
        "id": "wEp4vfM6B",
        "position": {
          "x": 912,
          "y": 240
        },
        "fpEnabled": true,
        "inputsDB": {
          "hardwareEncoder": "hevc_vaapi"
        }
      },
      {
        "name": "Prevent sleep (Windows)",
        "sourceRepo": "Local",
        "pluginName": "keepAwake",
        "version": "1.0.0",
        "id": "iIepjcd-i",
        "position": {
          "x": 984,
          "y": 84
        },
        "fpEnabled": true
      },
      {
        "name": "Allow sleep (Windows)",
        "sourceRepo": "Local",
        "pluginName": "keepAwake",
        "version": "1.0.0",
        "id": "yCde19y26",
        "position": {
          "x": 672,
          "y": 600
        },
        "fpEnabled": true,
        "inputsDB": {
          "action": "stop"
        }
      }
    ],
    "flowEdges": [
      {
        "source": "JTeKdNnFR",
        "sourceHandle": "1",
        "target": "IBXuDL7Dx",
        "targetHandle": null,
        "id": "mTVJWcMTG"
      },
      {
        "source": "IBXuDL7Dx",
        "sourceHandle": "1",
        "target": "tpYlSXpfK",
        "targetHandle": null,
        "id": "3VXdY7ayD"
      },
      {
        "source": "d7QK1TBlh",
        "sourceHandle": "1",
        "target": "Y40uvSwMF",
        "targetHandle": null,
        "id": "tagToExecute"
      },
      {
        "source": "Y40uvSwMF",
        "sourceHandle": "1",
        "target": "cnvMarkEncDone",
        "targetHandle": null,
        "id": "Vu9HtsSNH"
      },
      {
        "source": "R0CsTy4Qw",
        "sourceHandle": "1",
        "target": "b8n51xYj4",
        "targetHandle": null,
        "id": "O0ZWCGN8b"
      },
      {
        "source": "X4ANCc9vI",
        "sourceHandle": "1",
        "target": "JTeKdNnFR",
        "targetHandle": null,
        "id": "vE6"
      },
      {
        "source": "qyqzR1Ocm",
        "sourceHandle": "1",
        "target": "qwYEerynw",
        "targetHandle": null,
        "id": "dZY17ylsS"
      },
      {
        "source": "SQedUStPK",
        "sourceHandle": "1",
        "target": "R0CsTy4Qw",
        "targetHandle": null,
        "id": "_zXcfY6xK"
      },
      {
        "source": "qwYEerynw",
        "sourceHandle": "1",
        "target": "SQedUStPK",
        "targetHandle": null,
        "id": "4oldrn25C"
      },
      {
        "source": "qualOffset",
        "sourceHandle": "1",
        "target": "d7QK1TBlh",
        "targetHandle": null,
        "id": "QX1zhAsW1"
      },
      {
        "source": "N2YufVfRT",
        "sourceHandle": "1",
        "target": "d7QK1TBlh",
        "targetHandle": null,
        "id": "VxJVhl3T1"
      },
      {
        "source": "tpYlSXpfK",
        "sourceHandle": "1",
        "target": "YbKi7dgS7",
        "targetHandle": null,
        "id": "13bZT7XGD"
      },
      {
        "source": "YbKi7dgS7",
        "sourceHandle": "1",
        "target": "-RGSfdo8K",
        "targetHandle": null,
        "id": "HJP6K6E5p"
      },
      {
        "source": "YbKi7dgS7",
        "sourceHandle": "2",
        "target": "tHF4vUCsM",
        "targetHandle": null,
        "id": "4DaK-Pwmt"
      },
      {
        "source": "-RGSfdo8K",
        "sourceHandle": "1",
        "target": "cnvMarkEnc",
        "targetHandle": null,
        "id": "vKgslqElF"
      },
      {
        "source": "FAc9QeWJK",
        "sourceHandle": "1",
        "target": "qualOffset",
        "targetHandle": null,
        "id": "faE1dVp4J"
      },
      {
        "source": "EuW3bnW-x",
        "sourceHandle": "2",
        "target": "Rn3WUT-NN",
        "targetHandle": null,
        "id": "BKx9P5i9u"
      },
      {
        "source": "Rn3WUT-NN",
        "sourceHandle": "1",
        "target": "N2YufVfRT",
        "targetHandle": null,
        "id": "_AT4rG44X"
      },
      {
        "source": "tHF4vUCsM",
        "sourceHandle": "1",
        "target": "7D1MRCH2-",
        "targetHandle": null,
        "id": "OoKwvGsGw"
      },
      {
        "source": "cnvMarkEnc",
        "sourceHandle": "1",
        "target": "ehGAkWvj7",
        "targetHandle": null,
        "id": "H1O1JVelz"
      },
      {
        "source": "7D1MRCH2-",
        "sourceHandle": "1",
        "target": "ehGAkWvj7",
        "targetHandle": null,
        "id": "OCYfqfsoe"
      },
      {
        "source": "EuW3bnW-x",
        "sourceHandle": "1",
        "target": "wEp4vfM6B",
        "targetHandle": null,
        "id": "8eTBTou_k"
      },
      {
        "source": "8V9_07K-F",
        "sourceHandle": "1",
        "target": "qualOffset",
        "targetHandle": null,
        "id": "PlS1fiYxS"
      },
      {
        "source": "wEp4vfM6B",
        "sourceHandle": "2",
        "target": "8V9_07K-F",
        "targetHandle": null,
        "id": "Gpdeh9ofI"
      },
      {
        "source": "wEp4vfM6B",
        "sourceHandle": "1",
        "target": "FAc9QeWJK",
        "targetHandle": null,
        "id": "KlaZJdm3S"
      },
      {
        "source": "ehGAkWvj7",
        "sourceHandle": "1",
        "target": "iIepjcd-i",
        "targetHandle": null,
        "id": "FGHzvB2k7"
      },
      {
        "source": "iIepjcd-i",
        "sourceHandle": "1",
        "target": "EuW3bnW-x",
        "targetHandle": null,
        "id": "tI2qp0lle"
      },
      {
        "source": "cnvMarkEncDone",
        "sourceHandle": "1",
        "target": "yCde19y26",
        "targetHandle": null,
        "id": "74D1x5vB0"
      },
      {
        "source": "yCde19y26",
        "sourceHandle": "1",
        "target": "qyqzR1Ocm",
        "targetHandle": null,
        "id": "HknPWkrMr"
      }
    ]
  });
exports.details = details;
